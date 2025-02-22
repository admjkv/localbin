// localbin.ts

// In-memory storage for pastes
const pastes = new Map<string, { content: string; created: Date }>();

// Generate a random alphanumeric ID
function generateId(length = 6): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < length; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// Simple HTML form to create a new paste
const htmlForm = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>LocalBin</title>
</head>
<body>
  <h1>LocalBin</h1>
  <form method="POST" action="/pastes">
    <textarea name="content" rows="10" cols="50" placeholder="Enter your text here"></textarea><br>
    <button type="submit">Submit</button>
  </form>
</body>
</html>
`;

// Use Deno.serve API to create a simple HTTP server
Deno.serve({ port: 8000 }, async (req: Request) => {
  const url = new URL(req.url);

  // Route: GET /
  if (req.method === "GET" && url.pathname === "/") {
    return new Response(htmlForm, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // Route: POST /pastes (handle JSON or form submissions)
  if (req.method === "POST" && url.pathname === "/pastes") {
    let content = "";
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await req.json();
      content = body.content;
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      content = formData.get("content")?.toString() || "";
    }

    if (!content) {
      return new Response("Content is required", { status: 400 });
    }

    const id = generateId();
    pastes.set(id, { content, created: new Date() });
    const responseBody =
      `Paste created! Access it at <a href="/pastes/${id}">/pastes/${id}</a>`;
    return new Response(responseBody, {
      status: 201,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // Route: GET /pastes/:id to retrieve a paste
  if (req.method === "GET" && url.pathname.startsWith("/pastes/")) {
    const id = url.pathname.split("/")[2];
    if (!pastes.has(id)) {
      return new Response("Paste not found", { status: 404 });
    }
    const { content, created } = pastes.get(id)!;
    const pasteHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Paste ${id}</title>
      </head>
      <body>
        <h1>Paste ID: ${id}</h1>
        <p><em>Created at: ${created.toLocaleString()}</em></p>
        <pre>${content}</pre>
        <a href="/">Back to Home</a>
      </body>
      </html>
    `;
    return new Response(pasteHtml, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // Fallback: Route not found
  return new Response("Not Found", { status: 404 });
});
