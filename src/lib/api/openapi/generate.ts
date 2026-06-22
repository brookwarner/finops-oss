import { z } from "zod";
import pkg from "../../../../package.json";
import responseDefs from "./responses.generated.json";
import { registry } from "./registry";

type AnyObj = Record<string, unknown>;

// ts-json-schema-generator emits { $schema, definitions }. Internal $refs use
// "#/definitions/X" — rewrite to "#/components/schemas/X" so they resolve inside
// the OpenAPI components block.
function responseComponents(): AnyObj {
  const root = responseDefs as AnyObj;
  const defs = (root.definitions as AnyObj) ?? (root.$defs as AnyObj) ?? {};
  const rewritten = JSON.stringify(defs)
    .replace(/#\/definitions\//g, "#/components/schemas/")
    .replace(/#\/\$defs\//g, "#/components/schemas/");
  return JSON.parse(rewritten) as AnyObj;
}

export function generateOpenApi() {
  const schemas = responseComponents();
  const paths: AnyObj = {};

  for (const r of registry) {
    const op: AnyObj = {
      summary: r.summary,
      security: [{ bearerAuth: [] }],
      responses: {
        [r.status ?? 200]: {
          description: "OK",
          content: { "application/json": { schema: { $ref: `#/components/schemas/${r.responseType}` } } },
        },
        "400": { description: "Invalid request", content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } } },
        "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } } },
      },
    };
    if (r.request?.query) {
      const js = z.toJSONSchema(r.request.query, { target: "openapi-3.1" }) as AnyObj;
      const props = (js.properties as AnyObj) ?? {};
      op.parameters = Object.keys(props).map((name) => ({
        name,
        in: "query",
        required: (js.required as string[] | undefined)?.includes(name) ?? false,
        schema: props[name],
      }));
    }
    if (r.request?.body) {
      op.requestBody = {
        required: true,
        content: { "application/json": { schema: z.toJSONSchema(r.request.body, { target: "openapi-3.1" }) } },
      };
    }
    paths[r.path] = { ...(paths[r.path] as AnyObj), [r.method.toLowerCase()]: op };
  }

  return {
    openapi: "3.1.0",
    info: { title: "FinOps REST API", version: (pkg as { version: string }).version },
    paths,
    components: {
      schemas,
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "PAT or OAuth JWT" } },
    },
  };
}
