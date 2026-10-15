export const RANDOM_EXAMPLE_PROMPTS = [
    'Create a ClickHouse table for movies with title, genre, release year, and rating. Insert representative sample records, then query average rating by genre.',
    'Create a ClickHouse table for countries with country, region, population, and land area. Insert representative sample records, then query population density by region.',
    'Create a ClickHouse table for sports results with sport, team, game date, points, and outcome. Insert representative sample records, then query win rate and average points by team.',
    'Create a ClickHouse table for music streams with stream time, artist, track, and genre. Insert representative sample records, then query stream counts by artist and genre.',
    'Create a ClickHouse table for coffee shop orders with order time, drink, quantity, and unit price. Insert representative sample records, then query total revenue by drink.',
    'Create a ClickHouse table for bike rentals with start time, station, duration, and distance. Insert representative sample records, then query ride counts and average duration by station.',
    'Create a ClickHouse table for city weather with observation date, city, temperature, and rainfall. Insert representative sample records, then query average temperature and total rainfall by city.',
    'Create a ClickHouse table for online store orders with order date, product, category, quantity, and unit price. Insert representative sample records, then query monthly revenue by category.',
    'Create a ClickHouse table for video game scores with player, game, played date, score, and duration. Insert representative sample records, then rank players by their best score per game.',
    'Create a ClickHouse table for books with title, author, genre, publication year, and rating. Insert representative sample records, then query the highest-rated genres.',
    'Create a ClickHouse table for flight departures with departure date, airline, origin, destination, and delay minutes. Insert representative sample records, then query average delay and on-time percentage by airline.',
    'Create a ClickHouse table for restaurant reviews with review date, restaurant, cuisine, city, and rating. Insert representative sample records, then query average rating and review count by cuisine.',
    'Create a ClickHouse table for fitness workouts with workout date, activity, duration, distance, and calories. Insert representative sample records, then query weekly workout time and calories by activity.',
    'Create a ClickHouse table for website visits with visit time, page, country, device, and session ID. Insert representative sample records, then query the most visited pages and unique sessions by device.',
    'Create a ClickHouse table for pet adoptions with adoption date, animal name, species, age, and shelter. Insert representative sample records, then query adoption counts and average age by species.',
    'Create a ClickHouse table for space launches with launch date, mission, rocket, launch site, and success flag. Insert representative sample records, then query launch counts and success rates by rocket.',
    'Create a ClickHouse table for train journeys with journey date, route, operator, passenger count, and delay minutes. Insert representative sample records, then query passenger totals and average delay by route.',
    'Create a ClickHouse table for hotel bookings with check-in date, city, hotel, nights, and nightly rate. Insert representative sample records, then query monthly booked nights and revenue by city.',
    'Create a ClickHouse table for home energy readings with reading time, household, energy source, and kilowatt-hours. Insert representative sample records, then query daily energy use by source.',
    'Create a ClickHouse table for grocery purchases with purchase date, store, product category, quantity, and unit price. Insert representative sample records, then query monthly spending by product category.',
] as const;

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
