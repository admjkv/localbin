// localbin.ts

import * as eta from "@eta-dev/eta";

// File-based storage with in-memory cache
const STORAGE_FILE = "./pastes.json";
let pastes = new Map<string, { content: string; created: Date; expiresAt?: Date }>();

// Initialize Eta after your other constants
const etaEngine = new eta.Eta({ views: "./templates" });

// Load existing pastes from file
async function loadPastes() {
  try {
    const fileContent = await Deno.readTextFile(STORAGE_FILE);
    const data = JSON.parse(fileContent) as Record<string, { content: string; created: string }>;
    
    // Convert plain objects back to Map with proper Date objects
    pastes = new Map(
      Object.entries(data).map(([id, paste]: [string, { content: string; created: string }]) => [
        id,
        { ...paste, created: new Date(paste.created) }
      ])
    );
    
    console.log(`Loaded ${pastes.size} pastes from storage`);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      console.error("Failed to load pastes:", error);
    }
    // File doesn't exist yet, that's fine for first run
    pastes = new Map();
  }
}

// Cleanup expired pastes
function cleanupExpiredPastes() {
  const now = new Date();
  let expired = 0;
  
  for (const [id, paste] of pastes.entries()) {
    if (paste.expiresAt && paste.expiresAt <= now) {
      pastes.delete(id);
      expired++;
    }
  }
  
  if (expired > 0) {
    console.log(`Cleaned up ${expired} expired pastes`);
    debouncedSavePastes();
  }
  
  // Schedule next cleanup
  setTimeout(cleanupExpiredPastes, 60 * 60 * 1000); // Run every hour
}

let saveTimeout: number | null = null;
function debouncedSavePastes() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  
  saveTimeout = setTimeout(async () => {
    await savePastes();
    saveTimeout = null;
  }, 2000) as unknown as number;
}

async function savePastes() {
  try {
    const data = Object.fromEntries(pastes.entries());
    const tempFile = `${STORAGE_FILE}.temp`;
    
    // Write to temp file first
    await Deno.writeTextFile(tempFile, JSON.stringify(data, null, 2));
    
    // Then rename to actual file (atomic operation)
    await Deno.rename(tempFile, STORAGE_FILE);
  } catch (error) {
    console.error("Failed to save pastes:", error);
  }
}

// Generate a random alphanumeric ID
function generateId(length = 6): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < length; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// HTML template for the homepage with form and list of pastes
function renderHomePage() {
  // Get all pastes sorted by creation date (newest first)
  const pasteList = Array.from(pastes.entries())
    .sort((a, b) => b[1].created.getTime() - a[1].created.getTime())
    .map(([id, paste]) => ({
      id,
      created: paste.created.toLocaleString(),
      preview: paste.content.length > 50 
        ? paste.content.substring(0, 50) + '...' 
        : paste.content
    }));

  return etaEngine.render("base", {
    title: "LocalBin",
    header: "LocalBin",
    backLink: "/list",
    backLinkText: "View All Pastes",
    body: etaEngine.render("home", {
      pastes: pasteList
    })
  });
}

// HTML template for the paste list page
function renderPasteListPage() {
  const pasteList = Array.from(pastes.entries())
    .sort((a, b) => b[1].created.getTime() - a[1].created.getTime())
    .map(([id, paste]) => ({
      id,
      created: paste.created.toLocaleString(),
      preview: paste.content.length > 100 
        ? paste.content.substring(0, 100) + '...' 
        : paste.content
    }));

  return etaEngine.render("base", {
    title: "All Pastes",
    header: "All Pastes",
    backLink: "/",
    backLinkText: "Back to Home",
    body: etaEngine.render("list", {
      pastes: pasteList
    })
  });
}

// Update your paste route handler to use the template
function renderPastePage(id: string, content: string, created: Date) {
  return etaEngine.render("base", {
    title: `Paste ${id}`,
    header: `Paste ID: ${id}`,
    backLink: "/",
    backLinkText: "Back to Home",
    body: etaEngine.render("paste", {
      content,
      created: created.toLocaleString()
    })
  });
}

// Helper function to serve static files
async function serveStaticFile(path: string, contentType: string): Promise<Response> {
  try {
    const file = await Deno.readFile(path);
    return new Response(file, {
      status: 200,
      headers: { "content-type": contentType },
    });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return new Response("File not found", { status: 404 });
    }
    return new Response("Internal server error", { status: 500 });
  }
}

// Error handling middleware
async function handleRequest(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);

    // Static file handler
    if (url.pathname.startsWith("/static/")) {
      const filePath = "." + url.pathname;
      const fileExt = filePath.split(".").pop()?.toLowerCase();
      
      // Map extensions to content types
      const contentTypes: Record<string, string> = {
        "css": "text/css",
        "js": "text/javascript",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "svg": "image/svg+xml"
      };
      
      const contentType = fileExt && contentTypes[fileExt] 
        ? contentTypes[fileExt] 
        : "application/octet-stream";
        
      return serveStaticFile(filePath, contentType);
    }

    // Route: GET / (Homepage with form and recent pastes)
    if (req.method === "GET" && url.pathname === "/") {
      return new Response(renderHomePage(), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // Route: GET /list (List all pastes)
    if (req.method === "GET" && url.pathname === "/list") {
      return new Response(renderPasteListPage(), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // Route: POST /pastes (handle JSON or form submissions)
    if (req.method === "POST" && url.pathname === "/pastes") {
      let content = "";
      let expirationHours: number | null = null;
      
      const contentType = req.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const body = await req.json();
        content = body.content;
        expirationHours = body.expirationHours ? parseInt(body.expirationHours) : null;
      } else if (contentType.includes("application/x-www-form-urlencoded")) {
        const formData = await req.formData();
        content = formData.get("content")?.toString() || "";
        const expiration = formData.get("expiration")?.toString();
        expirationHours = expiration ? parseInt(expiration) : null;
      }

      if (!content) {
        return new Response("Content is required", { status: 400 });
      }

      const id = generateId();
      const created = new Date();
      const pasteData: { content: string; created: Date; expiresAt?: Date } = { content, created };
      
      // Add expiration if specified
      if (expirationHours && !isNaN(expirationHours)) {
        const expiresAt = new Date(created);
        expiresAt.setHours(expiresAt.getHours() + expirationHours);
        pasteData.expiresAt = expiresAt;
      }
      
      pastes.set(id, pasteData);
      
      // Save pastes after adding a new one
      await debouncedSavePastes();
      
      // Redirect to the new paste page
      return new Response(null, {
        status: 302,
        headers: { "Location": `/pastes/${id}` },
      });
    }

    // Route: GET /pastes/:id to retrieve a paste
    if (req.method === "GET" && url.pathname.startsWith("/pastes/")) {
      const id = url.pathname.split("/")[2];
      if (!pastes.has(id)) {
        return new Response("Paste not found", { status: 404 });
      }
      const { content, created } = pastes.get(id)!;
      return new Response(renderPastePage(id, content, created), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // Fallback: Route not found
    return new Response("Not Found", { status: 404 });
  } catch (error) {
    console.error("Request handler error:", error);
    return new Response("Internal Server Error", { 
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
}

// Initialize by loading existing pastes
await loadPastes();
// Start the cleanup process
cleanupExpiredPastes();

// Use Deno.serve API with the error handling middleware
Deno.serve({ port: 8000 }, handleRequest);
