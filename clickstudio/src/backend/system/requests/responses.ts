export function json(body: unknown, status = 200): Response {
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function fail(code: string, message: string, status = 400): Response {
    return json({ error: { code, message } }, status);
}
