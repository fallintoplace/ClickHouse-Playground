-- ClickStudio demo: summer shop traffic.
-- Runs on any ClickHouse connection. No tables or CSV imports are needed.
-- All data is fictional and repeatable. Currency: EUR.
-- Run the whole query, then try a line chart with day and revenue_eur.
-- Compare channels with a stacked bar chart using day, channel, and sessions.

WITH
    -- 20,000 sessions across July, August, and September 2026.
    -- Different hash inputs keep the demo dimensions independent.
    raw_sessions AS
    (
        SELECT
            number + 1 AS session_id,
            cityHash64(number, 'visitor') % 3500 + 1 AS visitor_id,
            toDate('2026-07-01')
                + toUInt32(cityHash64(number, 'day') % 92) AS day,
            toUInt8(cityHash64(number, 'hour') % 24) AS hour,
            arrayElement(
                ['Organic', 'Paid search', 'Email', 'Social'],
                cityHash64(number, 'channel') % 4 + 1
            ) AS channel,
            arrayElement(
                ['Poland', 'Germany', 'France', 'Spain', 'Netherlands', 'Sweden'],
                cityHash64(number, 'country') % 6 + 1
            ) AS country,
            arrayElement(
                ['Desktop', 'Mobile', 'Tablet'],
                cityHash64(number, 'device') % 3 + 1
            ) AS device,
            toUInt16(15 + cityHash64(number, 'duration') % 900) AS duration_seconds,
            toUInt8(1 + cityHash64(number, 'pages') % 12) AS page_views,
            cityHash64(number, 'purchase') % 100 AS purchase_roll,
            toDecimal64(1500 + cityHash64(number, 'basket') % 25000, 2)
                / 100 AS basket_value_eur
        FROM numbers(20000)
    ),

    -- September's email campaign has a higher conversion rate.
    -- A session contains at most one order in this dataset.
    session_facts AS
    (
        SELECT
            session_id,
            visitor_id,
            day,
            hour,
            channel,
            country,
            device,
            duration_seconds,
            page_views,
            toUInt8(
                purchase_roll < multiIf(
                    channel = 'Email' AND toMonth(day) = 9, 21,
                    channel = 'Email', 15,
                    channel = 'Paid search', 12,
                    device = 'Mobile', 7,
                    10
                )
            ) AS converted,
            if(converted = 1, basket_value_eur, toDecimal64(0, 2)) AS revenue_eur
        FROM raw_sessions
    ),

    -- Daily channel metrics feed both the table and the chart.
    daily_metrics AS
    (
        SELECT
            day,
            channel,
            count() AS sessions,
            uniqExact(visitor_id) AS visitors,
            sum(converted) AS orders,
            sum(revenue_eur) AS revenue_eur,
            round(avg(duration_seconds), 1) AS avg_duration_seconds,
            round(avg(page_views), 2) AS pages_per_session,
            countIf(page_views = 1) AS bounced_sessions,
            countIf(device = 'Mobile') AS mobile_sessions,
            uniqExact(country) AS countries_reached
        FROM session_facts
        GROUP BY day, channel
    ),

    -- Synthetic daily spend. Organic traffic has no paid campaign spend.
    -- Keep zero spend visible so ROAS can be NULL for Organic.
    campaign_spend AS
    (
        SELECT
            toDate('2026-07-01') + toUInt32(number) AS day,
            channel,
            toDecimal64(
                multiIf(
                    channel = 'Organic', 0,
                    channel = 'Paid search', 100 + cityHash64(number, channel) % 80,
                    channel = 'Social', 55 + cityHash64(number, channel) % 45,
                    15 + cityHash64(number, channel) % 15
                ),
                2
            ) AS ad_spend_eur
        FROM numbers(92)
        ARRAY JOIN ['Organic', 'Paid search', 'Email', 'Social'] AS channel
    ),

    -- LEFT JOIN keeps all traffic, including channels with zero spend.
    channel_performance AS
    (
        SELECT
            m.day AS day,
            m.channel AS channel,
            m.sessions AS sessions,
            m.visitors AS visitors,
            m.orders AS orders,
            m.revenue_eur AS revenue_eur,
            s.ad_spend_eur AS ad_spend_eur,
            m.avg_duration_seconds AS avg_duration_seconds,
            m.pages_per_session AS pages_per_session,
            m.countries_reached AS countries_reached,
            round(100.0 * m.orders / nullIf(m.sessions, 0), 2) AS conversion_rate_pct,
            round(100.0 * m.bounced_sessions / nullIf(m.sessions, 0), 2) AS bounce_rate_pct,
            round(100.0 * m.mobile_sessions / nullIf(m.sessions, 0), 2) AS mobile_share_pct
        FROM daily_metrics AS m
        LEFT JOIN campaign_spend AS s
            ON m.day = s.day AND m.channel = s.channel
    ),

    -- Every channel has sessions on every day in this fixed dataset.
    -- Seven rows therefore represent seven calendar days.
    ranked_performance AS
    (
        SELECT
            *,
            dense_rank() OVER (
                PARTITION BY day
                ORDER BY revenue_eur DESC
            ) AS daily_revenue_rank,
            sum(revenue_eur) OVER (
                PARTITION BY channel
                ORDER BY day
                ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
            ) AS rolling_7d_revenue_eur,
            sum(revenue_eur) OVER (
                PARTITION BY channel
                ORDER BY day
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS cumulative_revenue_eur
        FROM channel_performance
    )

SELECT
    day,
    channel,
    sessions,
    visitors,
    orders,
    conversion_rate_pct,
    round(revenue_eur, 2) AS revenue_eur,
    ad_spend_eur,
    round(toFloat64(revenue_eur) / nullIf(toFloat64(ad_spend_eur), 0), 2) AS roas,
    round(toFloat64(revenue_eur) / nullIf(orders, 0), 2) AS average_order_value_eur,
    bounce_rate_pct,
    mobile_share_pct,
    avg_duration_seconds,
    pages_per_session,
    countries_reached,
    daily_revenue_rank,
    round(rolling_7d_revenue_eur, 2) AS rolling_7d_revenue_eur,
    round(cumulative_revenue_eur, 2) AS cumulative_revenue_eur
FROM ranked_performance
ORDER BY day, channel;
