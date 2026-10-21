export const dynamic = "force-dynamic";

/** Version-pinned Scalar standalone bundle (major-pinned for stability). */
const SCALAR_CDN = "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1";

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>FinOps API reference</title>
</head>
<body>
<script id="api-reference" data-url="/api/openapi.json"></script>
<script>
  document.getElementById("api-reference").dataset.configuration = JSON.stringify({
    darkMode: true,
    metaData: { title: "FinOps API reference" },
  });
</script>
<script src="${SCALAR_CDN}"></script>
</body>
</html>`;

/**
 * GET /docs — human-browsable API reference. Serves a minimal HTML page that
 * mounts Scalar (loaded from CDN) against the public `/api/openapi.json` spec.
 * Public, like the spec it renders; mirrors `api/openapi.json/route.ts`.
 */
export function GET() {
  return new Response(PAGE, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
