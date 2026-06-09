import path from "node:path";

export function normalizeDocumentPathForDisplay(filePath) {
  return String(filePath || "").replace(/\\/g, "/");
}

export function commonDirectoryPath(directoryPaths = []) {
  const resolvedPaths = directoryPaths.map((directoryPath) => path.resolve(String(directoryPath || ""))).filter(Boolean);
  if (!resolvedPaths.length) return "";
  if (resolvedPaths.length === 1) return resolvedPaths[0];

  const root = path.parse(resolvedPaths[0]).root;
  if (!resolvedPaths.every((directoryPath) => path.parse(directoryPath).root === root)) return "";

  const pathSegments = resolvedPaths.map((directoryPath) =>
    directoryPath
      .slice(root.length)
      .split(path.sep)
      .filter(Boolean),
  );
  let commonLength = pathSegments[0].length;

  for (const segments of pathSegments.slice(1)) {
    while (commonLength > 0 && pathSegments[0][commonLength - 1] !== segments[commonLength - 1]) {
      commonLength -= 1;
    }
  }

  return path.join(root, ...pathSegments[0].slice(0, commonLength));
}

export function documentRelativeRoot(selectedEntries = []) {
  const directoryPaths = selectedEntries
    .filter((entry) => entry?.filePath)
    .map((entry) => (entry.isDirectory ? entry.filePath : path.dirname(entry.filePath)));
  return commonDirectoryPath(directoryPaths);
}

export function documentRelativePath(filePath, rootDirectory) {
  const resolvedPath = path.resolve(String(filePath || ""));
  const resolvedRoot = rootDirectory ? path.resolve(String(rootDirectory)) : path.dirname(resolvedPath);
  const relativePath = path.relative(resolvedRoot, resolvedPath) || path.basename(resolvedPath);

  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    const parentName = path.basename(path.dirname(resolvedPath));
    return normalizeDocumentPathForDisplay(parentName ? path.join(parentName, path.basename(resolvedPath)) : path.basename(resolvedPath));
  }

  return normalizeDocumentPathForDisplay(relativePath);
}
