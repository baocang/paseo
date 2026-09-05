# Element context providers

Paseo's Electron browser can turn a selected page element into a structured change request for the
active coding agent. A page can register an element context provider when DOM attributes and computed
styles do not describe the component's real editable model.

The provider describes edits. Paseo does not call it to mutate the page. The selected element, provider
identity, current values, requested values, free-text instruction, and screenshot travel through the
existing Composer attachment path.

## Register a provider

Set the registry in the page's main JavaScript world before the user starts the element picker:

```ts
window.__PASEO_ELEMENT_CONTEXT__ = {
  version: 1,
  providers: [
    {
      id: "my-low-code-platform",
      priority: 100,
      match(element) {
        return element instanceof HTMLElement && element.dataset.componentId !== undefined;
      },
      async resolve(element, selection) {
        const componentId = element.dataset.componentId;
        const component = await loadComponentMetadata(componentId);
        return {
          version: 1,
          provider: { id: "my-low-code-platform", label: "Page schema" },
          target: {
            id: component.id,
            label: component.label,
            kind: component.type,
            revision: component.revision,
            selector: selection.selector,
          },
          fields: component.properties.map(toPaseoField),
          context: { schemaId: component.schemaId },
        };
      },
    },
  ],
};
```

Paseo orders providers by descending `priority`. For each provider it tests the clicked element and up
to 11 ancestors, nearest first. `match` is optional. `resolve` receives the candidate element plus
`{ clickedElement, selector, url }`. A provider has one second for each call. A rejected, timed-out, or
invalid provider is skipped; Paseo falls back to its built-in DOM context.

## Context shape

Provider results must be JSON-serializable:

```ts
interface ElementContext {
  version: 1;
  provider: { id: string; label?: string };
  target: {
    id: string;
    label: string;
    kind?: string;
    selector?: string;
    source?: string;
    revision?: string;
  };
  fields: ElementField[];
  context?: JsonValue;
}

interface ElementField {
  id: string;
  path?: string;
  label: string;
  editor:
    | "text"
    | "textarea"
    | "number"
    | "boolean"
    | "select"
    | "multiselect"
    | "color"
    | "radio"
    | "checkbox-group"
    | "slider"
    | "date"
    | "time"
    | "datetime"
    | "json"
    | "code"
    | "key-value"
    | "table"
    | "custom";
  value: JsonValue;
  group?: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  options?: Array<{ label: string; value: JsonValue; disabled?: boolean }>;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  language?: string;
  customEditor?: string;
}
```

`id` is the stable property identity shown to the agent. Use `path` for the actual nested schema path.
Use `target.revision` when the agent should verify that its source data has not changed. Put opaque
identifiers needed to locate source metadata in `context`; do not put credentials or user data there.

Paseo renders `text`, `textarea`, `number`, `boolean`, `select`, `multiselect`, `color`, `slider`,
`date`, `time`, and `datetime` directly. Structured and custom editors use a multiline text fallback.
An unknown editor is kept as `custom` with its original name in `customEditor`, so the agent still
receives the provider's intent. Providers cannot return React/Vue components, HTML, or executable
editor code.

Provider data crosses an untrusted page boundary. Paseo limits it to 100 fields, 200 options per field,
4,000 characters per string, five JSON levels, and 100 items per array or object. Duplicate field ids
keep the first valid field. Agent attachments frame the normalized result as untrusted, escaped JSON;
page-provided labels and descriptions are data, not agent instructions.

## CJ Cloud adapter

For `cj-cloud-ui`, match the nearest element with `data-c-uuid` and `data-c-component-is`. Use the UUID
as `target.id`, `componentIs` or the component alias as `target.kind`, and map the component's
`propsSchema` / `styleSchema` entries to fields. Preserve dotted `fieldKey` values as `path`; evaluate
dynamic visibility, read-only state, and options before returning the context. Map custom OForm editors
to the closest declared editor and use `custom` when no direct mapping exists.

Keep the adapter in the application that owns the runtime schema. Paseo only owns this provider entry
and the normalized change-request format.
