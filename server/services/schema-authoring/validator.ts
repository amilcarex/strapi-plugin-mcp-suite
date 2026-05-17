import type { Core } from "@strapi/strapi";

/**
 * Validador de propuestas de schema antes de escribir al filesystem.
 *
 * Detecta 8 categorías de violations:
 *   1. NESTED_COMPONENT_DEPTH_EXCEEDED  — Strapi UI permite solo 1 nivel de
 *      anidamiento de components. Más profundo requiere dynamiczone o
 *      promover a content-type con relación.
 *   2. RESERVED_ATTRIBUTE_NAME — bloquea id/documentId/createdAt/etc.
 *   3. INVALID_NAME / NON_CONVENTIONAL_NAME — kebab-case para archivos, etc.
 *   4. MISSING_REQUIRED_PROP — propiedades obligatorias por tipo.
 *   5. UNKNOWN_REFERENCE — UIDs de component/relation deben existir.
 *   6. CIRCULAR_REFERENCE — DFS sobre component attrs (dynamiczone rompe ciclo).
 *   7. RELATION_RECIPROCITY_MISSING — warning si inversedBy sin mappedBy.
 *   8. COLLISION_COLLECTION_NAME — error si collectionName ya existe.
 */

export type Severity = "error" | "warning";

export type Violation = {
  code: string;
  severity: Severity;
  path: string;
  message: string;
  suggestion?: string;
  fix_example?: any;
};

export type ValidationResult = {
  valid: boolean;
  violations: Violation[];
  warnings: Violation[];
};

export type ValidationMode = "create" | "update";

export type ProposalKind = "content-type" | "component";

export type SchemaProposal = {
  uid: string;
  kind: ProposalKind;
  schema: any;
};

const RESERVED_ATTRIBUTE_NAMES = new Set([
  "id",
  "documentId",
  "createdAt",
  "updatedAt",
  "publishedAt",
  "createdBy",
  "updatedBy",
  "locale",
  "localizations",
]);

const KEBAB_CASE = /^[a-z][a-z0-9-]*$/;
const ATTR_NAME = /^[a-z][a-zA-Z0-9_]*$/;

/**
 * Detecta si @strapi/plugin-graphql está instalado en el proyecto.
 * Usado por la regla ENUM_VALUE_INVALID_GRAPHQL_NAME para evitar warnings
 * irrelevantes en proyectos que no exponen GraphQL.
 */
function isGraphqlPluginInstalled(strapi: Core.Strapi): boolean {
  try {
    return !!(strapi as any).plugin?.("graphql");
  } catch {
    return false;
  }
}

export function validateSchemaProposal(
  strapi: Core.Strapi,
  proposal: SchemaProposal,
  mode: ValidationMode
): ValidationResult {
  const violations: Violation[] = [];
  const warnings: Violation[] = [];

  const { uid, kind, schema } = proposal;

  // ── Naming: UID + info ────────────────────────────────────────────────────
  if (kind === "component") {
    const [category, name] = uid.split(".");
    if (!category || !KEBAB_CASE.test(category)) {
      violations.push({
        code: "INVALID_NAME",
        severity: "error",
        path: `uid (category="${category}")`,
        message: `La categoría "${category}" debe ser kebab-case (a-z, 0-9, guion).`,
      });
    }
    if (!name || !KEBAB_CASE.test(name)) {
      violations.push({
        code: "INVALID_NAME",
        severity: "error",
        path: `uid (name="${name}")`,
        message: `El nombre "${name}" debe ser kebab-case (a-z, 0-9, guion).`,
      });
    }
  } else if (kind === "content-type") {
    if (!uid.startsWith("api::")) {
      violations.push({
        code: "INVALID_NAME",
        severity: "error",
        path: `uid="${uid}"`,
        message: `Content-type UID debe empezar con "api::". Formato: "api::{singular}.{singular}".`,
      });
    }
    const singularName = schema?.info?.singularName;
    const pluralName = schema?.info?.pluralName;
    if (!singularName || !KEBAB_CASE.test(singularName)) {
      violations.push({
        code: "INVALID_NAME",
        severity: "error",
        path: "info.singularName",
        message: `info.singularName="${singularName}" debe ser kebab-case.`,
      });
    }
    if (!pluralName || !KEBAB_CASE.test(pluralName)) {
      violations.push({
        code: "INVALID_NAME",
        severity: "error",
        path: "info.pluralName",
        message: `info.pluralName="${pluralName}" debe ser kebab-case.`,
      });
    }
  }

  // ── Colisión de collectionName (solo content-types) ───────────────────────
  if (kind === "content-type" && mode === "create" && schema?.collectionName) {
    const existing = Object.entries((strapi.contentTypes as any) ?? {}).find(
      ([otherUid, ct]: [string, any]) =>
        otherUid !== uid && ct.collectionName === schema.collectionName
    );
    if (existing) {
      violations.push({
        code: "COLLISION_COLLECTION_NAME",
        severity: "error",
        path: "collectionName",
        message: `collectionName "${schema.collectionName}" ya existe en ${existing[0]}.`,
        suggestion: `Elige otro collectionName, o reusa el content-type existente.`,
      });
    }
  }

  // ── Atributos ──────────────────────────────────────────────────────────────
  const attrs = schema?.attributes ?? {};
  for (const [attrName, attr] of Object.entries<any>(attrs)) {
    const path = `attributes.${attrName}`;

    // Reserved
    if (RESERVED_ATTRIBUTE_NAMES.has(attrName)) {
      violations.push({
        code: "RESERVED_ATTRIBUTE_NAME",
        severity: "error",
        path,
        message: `"${attrName}" es un campo reservado por Strapi. No puede ser declarado en attributes.`,
      });
    }

    // Naming convention
    if (!ATTR_NAME.test(attrName)) {
      warnings.push({
        code: "NON_CONVENTIONAL_NAME",
        severity: "warning",
        path,
        message: `"${attrName}" no sigue la convención typical de Strapi (camelCase o snake_case empezando con minúscula).`,
      });
    }

    // Required props by type
    switch (attr?.type) {
      case "relation":
        if (!attr.relation) {
          violations.push({
            code: "MISSING_REQUIRED_PROP",
            severity: "error",
            path,
            message: `relation attribute requiere prop "relation" (oneToOne|oneToMany|manyToOne|manyToMany).`,
          });
        }
        if (!attr.target) {
          violations.push({
            code: "MISSING_REQUIRED_PROP",
            severity: "error",
            path,
            message: `relation attribute requiere prop "target" (UID del content-type destino, ej: api::article.article).`,
          });
        }
        if (attr.inversedBy && !attr.mappedBy && attr.target) {
          // Reciprocidad: si seteás inversedBy, el target debería tener mappedBy
          const targetCt = (strapi.contentTypes as any)?.[attr.target];
          if (targetCt) {
            const hasReciprocal = Object.values<any>(targetCt.attributes ?? {}).some(
              (a) => a?.type === "relation" && a?.mappedBy === attrName
            );
            if (!hasReciprocal) {
              warnings.push({
                code: "RELATION_RECIPROCITY_MISSING",
                severity: "warning",
                path,
                message: `inversedBy="${attr.inversedBy}" apunta a "${attr.target}" pero ningún atributo de ese CT tiene mappedBy="${attrName}".`,
                suggestion: `Agrega un atributo relation con "mappedBy": "${attrName}" en ${attr.target}, o quita inversedBy.`,
              });
            }
          }
        }
        break;
      case "enumeration":
        if (!Array.isArray(attr.enum) || attr.enum.length === 0) {
          violations.push({
            code: "MISSING_REQUIRED_PROP",
            severity: "error",
            path,
            message: `enumeration attribute requiere prop "enum" como array no vacío.`,
          });
        } else if (isGraphqlPluginInstalled(strapi)) {
          // Solo emitimos warning si @strapi/plugin-graphql está instalado.
          // GraphQL spec requiere que cada enum value sea un identifier válido:
          // ^[_A-Za-z][_0-9A-Za-z]*$. Si usás el plugin, los values que empiecen
          // con dígito serán DROPPED silenciosamente por Nexus, y si todos son
          // inválidos el plugin tira "Enum must have at least one member" al boot.
          // Si NO usás GraphQL, los values con dígitos son 100% válidos para
          // Strapi REST y admin — por eso no warneamos.
          const GRAPHQL_NAME = /^[_A-Za-z][_0-9A-Za-z]*$/;
          const invalid = attr.enum.filter(
            (v: any) => typeof v !== "string" || !GRAPHQL_NAME.test(v)
          );
          if (invalid.length > 0) {
            const suggestion = invalid.map((v: any) => {
              if (typeof v !== "string") return `${v} → '${String(v)}_value'`;
              if (/^\d/.test(v)) return `'${v}' → '_${v}' o '${v.replace(/^(\d)/, (m) => `n${m}`)}'`;
              return `'${v}' → reemplaza chars inválidos`;
            }).join(", ");
            warnings.push({
              code: "ENUM_VALUE_INVALID_GRAPHQL_NAME",
              severity: "warning",
              path,
              message: `Detecté @strapi/plugin-graphql instalado. Los siguientes enum values no son nombres válidos para GraphQL (deben matchear ^[_A-Za-z][_0-9A-Za-z]*$): [${invalid.map((v: any) => `'${v}'`).join(", ")}]. Nexus los filtra y puede dejar el enum vacío, lo cual impide que Strapi arranque.`,
              suggestion: `Renombra: ${suggestion}. Si no querés cambiarlos y aceptás el riesgo (ej: el campo no se expone vía GraphQL), pasa force:true.`,
            });
          }
        }
        break;
      case "uid":
        if (!attr.targetField) {
          warnings.push({
            code: "MISSING_REQUIRED_PROP",
            severity: "warning",
            path,
            message: `uid attribute sin "targetField" — Strapi generará un slug aleatorio. Considera especificar.`,
          });
        }
        break;
      case "component":
        if (!attr.component) {
          violations.push({
            code: "MISSING_REQUIRED_PROP",
            severity: "error",
            path,
            message: `component attribute requiere prop "component" (UID del component).`,
          });
        }
        if (attr.repeatable === undefined) {
          warnings.push({
            code: "MISSING_REQUIRED_PROP",
            severity: "warning",
            path,
            message: `component attribute debería declarar "repeatable" (true|false). Default Strapi: false.`,
          });
        }
        break;
      case "dynamiczone":
        if (!Array.isArray(attr.components) || attr.components.length === 0) {
          violations.push({
            code: "MISSING_REQUIRED_PROP",
            severity: "error",
            path,
            message: `dynamiczone attribute requiere prop "components" como array no vacío de UIDs.`,
          });
        }
        break;
      case "media":
        if (!attr.allowedTypes) {
          warnings.push({
            code: "MISSING_REQUIRED_PROP",
            severity: "warning",
            path,
            message: `media attribute sin "allowedTypes" — acepta cualquier tipo. Considera restringir (ej: ["images", "videos"]).`,
          });
        }
        break;
    }

    // UNKNOWN_REFERENCE: components/dynamiczone components/relation target
    if (attr?.type === "component" && attr.component) {
      const exists =
        (strapi.components as any)?.[attr.component] !== undefined ||
        (kind === "component" && uid === attr.component);
      if (!exists) {
        violations.push({
          code: "UNKNOWN_REFERENCE",
          severity: "error",
          path,
          message: `Component UID "${attr.component}" no existe en strapi.components.`,
          suggestion: `Primero crea el component, luego referéncialo. O revisa si el UID es correcto.`,
        });
      }
    }
    if (attr?.type === "dynamiczone" && Array.isArray(attr.components)) {
      for (const compUid of attr.components) {
        if ((strapi.components as any)?.[compUid] === undefined) {
          violations.push({
            code: "UNKNOWN_REFERENCE",
            severity: "error",
            path: `${path}.components[${compUid}]`,
            message: `Component UID "${compUid}" no existe en strapi.components.`,
          });
        }
      }
    }
    if (attr?.type === "relation" && attr.target) {
      const exists =
        (strapi.contentTypes as any)?.[attr.target] !== undefined ||
        (kind === "content-type" && uid === attr.target);
      if (!exists) {
        violations.push({
          code: "UNKNOWN_REFERENCE",
          severity: "error",
          path,
          message: `Content-type UID "${attr.target}" no existe en strapi.contentTypes.`,
        });
      }
    }
  }

  // ── NESTED_COMPONENT_DEPTH_EXCEEDED ───────────────────────────────────────
  // Regla Strapi UI: un component puede contener otro component, pero ese segundo
  // NO puede contener otro component (solo 1 nivel de nesting). Dynamiczone resetea.
  // BFS desde cada attribute de la proposal que sea type=component.
  if (kind === "component") {
    for (const [attrName, attr] of Object.entries<any>(attrs)) {
      if (attr?.type === "component" && attr.component) {
        const nestedComp = (strapi.components as any)?.[attr.component];
        if (nestedComp) {
          for (const [innerName, innerAttr] of Object.entries<any>(nestedComp.attributes ?? {})) {
            if (innerAttr?.type === "component") {
              violations.push({
                code: "NESTED_COMPONENT_DEPTH_EXCEEDED",
                severity: "error",
                path: `attributes.${attrName}.component → ${attr.component}.attributes.${innerName}`,
                message: `El component "${uid}" referencia a "${attr.component}", que a su vez referencia a "${innerAttr.component}". Strapi UI solo permite 1 nivel de anidamiento de components.`,
                suggestion: `Opciones: (a) promover "${innerAttr.component}" a un content-type y referenciarlo via relation; (b) aplanar los campos de "${innerAttr.component}" dentro de "${attr.component}"; (c) cambiar el attribute a dynamiczone (que resetea el contador de profundidad).`,
                fix_example: {
                  type: "dynamiczone",
                  components: [attr.component],
                },
              });
            }
          }
        }
      }
    }
  }

  // ── CIRCULAR_REFERENCE — DFS sobre component attrs ────────────────────────
  if (kind === "component") {
    const visited = new Set<string>();
    const stack = new Set<string>();
    const target = uid;

    const dfs = (currentUid: string): boolean => {
      if (stack.has(currentUid)) return true;
      if (visited.has(currentUid)) return false;
      visited.add(currentUid);
      stack.add(currentUid);

      const currentAttrs =
        currentUid === uid ? attrs : (strapi.components as any)?.[currentUid]?.attributes ?? {};

      for (const [, attr] of Object.entries<any>(currentAttrs)) {
        // dynamiczone rompe ciclos
        if (attr?.type === "component" && attr.component) {
          if (dfs(attr.component)) return true;
        }
      }
      stack.delete(currentUid);
      return false;
    };

    // Si existe ciclo que pasa por uid
    for (const attr of Object.values<any>(attrs)) {
      if (attr?.type === "component" && attr.component && attr.component !== target) {
        if (dfs(attr.component) && stack.has(target)) {
          violations.push({
            code: "CIRCULAR_REFERENCE",
            severity: "error",
            path: `attributes`,
            message: `Detectada referencia circular entre components pasando por "${uid}". Strapi no soporta ciclos sin dynamiczone.`,
            suggestion: `Insertar un dynamiczone en algún punto del ciclo, o aplanar uno de los components, o promover uno a content-type.`,
          });
          break;
        }
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
    warnings,
  };
}
