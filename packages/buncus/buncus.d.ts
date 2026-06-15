// `with { type: "file" }` imports resolve to a runtime path string (Bun embeds
// the file in the compiled binary). Declare the asset modules for tsc.
declare module "*.css" {
  const path: string;
  export default path;
}
declare module "*.js" {
  const path: string;
  export default path;
}
