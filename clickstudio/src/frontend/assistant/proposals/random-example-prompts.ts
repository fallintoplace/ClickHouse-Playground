const randomExampleQuestions = [
    'Recommend five movies for each viewer based on the genres they watch most. Exclude movies they have already watched, and only recommend titles with at least 100 ratings and an average score above 8.',
    "Which three countries in each region had the fastest population growth last year? Match annual population estimates to the country directory, exclude countries with fewer than one million residents, and show each country's share of its region's population.",
    'Build a sports league table from match results and the team directory, counting both home and away matches. Award three points for a win and one for a draw, break ties by goal difference, and include teams that have not played yet.',
    'For each music artist, group listeners by the week they first listened and show what percentage returned in each of the next three weeks. Count each listener once per week, and leave weeks that have not happened yet blank.',
    'Calculate daily coffee shop revenue by drink using the menu price in effect when each order was placed. Prices can change during the day. Flag orders without a known price instead of treating them as free.',
    'Which bike rental stations send the most riders to a different neighborhood? Match the start and end stations to their locations, estimate the distance between them from their coordinates, and exclude trips that return to the same station.',
    'Show daily temperatures for each city over the past month, including days with no weather reading. Add a seven-day moving average, and keep missing readings distinct from a temperature of zero.',
    'For each signup month, show how many online store customers placed their first order within 30 days and how many of those customers ordered again in the calendar month after their first order. Calculate their revenue after refunds, without counting an order twice when it contains several products.',
    'How many video game players installed the game, finished the tutorial, and won their first match, in that order within one hour of installation? Break down the result by the campaign that acquired each player, and show where players dropped out.',
    'Which book genres have the strongest reader ratings? A book can belong to several genres and should contribute to each one. Match reviews to the book catalog, exclude books with fewer than ten reviews, and show the three highest-rated books in each genre.',
    "Which airports have the highest missed-connection rate? Match each passenger's incoming and connecting flights and compare actual arrival with the connecting flight's actual departure. A passenger needs at least 45 minutes to transfer. Compare the result by airport and airline.",
    "Find the three best-rated restaurants in each city with at least 50 reviews. Customers can edit a review, and updates may arrive out of order, so count only the latest version of each review and include the restaurant's cuisine.",
    "Find each person's longest streak of consecutive workout days and the calories burned during that streak. Several workouts on one day should count as one active day, and a day without a workout breaks the streak. If several streaks tie, show the earliest one.",
    'Summarize website visits into sessions, starting a new session after at least 30 minutes of inactivity for the same visitor. Show the pages in the order they were visited, the entry and exit pages, and the median and 95th-percentile session durations by device.',
    'Compare pet shelters by the percentage of animals adopted within 30 days of becoming available. Include animals that were never adopted, only evaluate animals with a full 30 days of follow-up, and exclude adoptions that ended in a return during that period.',
    'Report space launch success rates by rocket and launch site for each month. Mission updates arrive as JSON, can be duplicated, and sometimes arrive out of order. Count each mission once using its latest reported status, and list any reported failure reasons.',
    'For each arriving train, find the earliest onward departure on a different train from the same station with between 10 and 90 minutes to transfer. Use full arrival and departure dates to handle connections after midnight, and keep arrivals that have no suitable connection.',
    "Show daily hotel occupancy for the next month by matching reservations to each hotel's room inventory. A booking occupies every night from check-in until checkout, the checkout day is free, cancelled bookings do not count, and days with no bookings should still appear.",
    'Calculate daily household electricity use and cost from cumulative meter readings and the tariff in effect at the time. Readings can arrive out of order, a meter can reset to zero, and a tariff can change during the day. Flag intervals spanning a reset, midnight, or a tariff change when the readings are insufficient to determine usage or cost, and keep daily totals with unknown contributions distinct from complete totals.',
    "Which grocery products are most often bought together? Show the three strongest companion products for each item and the percentage of that item's baskets containing each companion. Count a product only once per basket, even when several units were purchased, and never pair an item with itself.",
] as const;

// Ask for outcomes and sample data while leaving schema design and SQL choices to the assistant.
export const RANDOM_EXAMPLE_PROMPTS = randomExampleQuestions.map(
    question =>
        `${question} Include a small, realistic sample dataset so I can run the example. Make the example safe to rerun; adding more sample data each time is fine.`,
);

export function createRandomExamplePicker(random: () => number = Math.random) {
    let remaining: string[] = [];
    let previous: string | undefined;

    return () => {
        if (!remaining.length) {
            remaining = [...RANDOM_EXAMPLE_PROMPTS];
            for (let index = remaining.length - 1; index > 0; index--) {
                const other = Math.floor(random() * (index + 1));
                [remaining[index], remaining[other]] = [remaining[other]!, remaining[index]!];
            }
            // Avoid repeating the last topic when starting a new shuffled deck.
            const last = remaining.length - 1;
            if (remaining[last] === previous) {
                [remaining[0], remaining[last]] = [remaining[last]!, remaining[0]!];
            }
        }

        previous = remaining.pop()!;
        return previous;
    };
}

// Share the deck across chats and panel remounts for this page visit.
export const nextRandomExamplePrompt = createRandomExamplePicker();
