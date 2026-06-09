import { describe, expect, it } from "vitest";
import path from "node:path";
import { documentRelativePath, documentRelativeRoot } from "./documentPaths.js";

describe("documentPaths", () => {
  it("keeps paths relative to a single selected folder", () => {
    const root = path.resolve("/workspace/notes");
    const filePath = path.resolve("/workspace/notes/react/hooks.md");

    expect(documentRelativePath(filePath, root)).toBe("react/hooks.md");
  });

  it("uses the common parent when multiple folders are selected", () => {
    const root = documentRelativeRoot([
      { filePath: path.resolve("/workspace/docs"), isDirectory: true },
      { filePath: path.resolve("/workspace/examples"), isDirectory: true },
    ]);

    expect(documentRelativePath(path.resolve("/workspace/docs/hooks.md"), root)).toBe("docs/hooks.md");
    expect(documentRelativePath(path.resolve("/workspace/examples/hooks.md"), root)).toBe("examples/hooks.md");
  });

  it("distinguishes same-name files selected from sibling folders", () => {
    const root = documentRelativeRoot([
      { filePath: path.resolve("/workspace/docs/hooks.md"), isDirectory: false },
      { filePath: path.resolve("/workspace/examples/hooks.md"), isDirectory: false },
    ]);

    expect(documentRelativePath(path.resolve("/workspace/docs/hooks.md"), root)).toBe("docs/hooks.md");
    expect(documentRelativePath(path.resolve("/workspace/examples/hooks.md"), root)).toBe("examples/hooks.md");
  });
});
