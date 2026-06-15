// Public API for @buncus/mock-github.
//
//   import { createMockGitHub } from "@buncus/mock-github";
//   const mock = createMockGitHub();          // in-process, no port
//   const res = await mock.fetch(new Request("http://gh/graphql", { ... }));
//
//   const mock = createMockGitHub().listen(0); // real Bun.serve on a port
//   // point buncus at it:  GITHUB_API_HOST = GITHUB_OAUTH_HOST = mock.url
//
// `mock.store` is the live in-memory state — seed extra repos/users/discussions
// before driving a flow, or assert against it after.

import { Store, type StoreOptions, resetIds } from "./store.ts";
import { handleRequest } from "./handler.ts";

export { Store, resetIds };
export type { StoreOptions };
export type {
  User,
  Repo,
  Category,
  Discussion,
  Comment,
  ReactionContent,
} from "./store.ts";

export interface MockGitHub {
  /** Live in-memory state. Seed before, assert after. */
  store: Store;
  /** In-process request handler — no network/port required. */
  fetch(req: Request): Promise<Response>;
  /** Start a real server. `url` is filled in after listen(). */
  listen(port?: number): MockGitHubServer;
}

export interface MockGitHubServer extends MockGitHub {
  url: string;
  port: number;
  stop(): void;
}

export function createMockGitHub(opts: StoreOptions = {}): MockGitHub {
  const store = new Store(opts);
  const fetch = (req: Request) => handleRequest(store, req);

  return {
    store,
    fetch,
    listen(port = 0): MockGitHubServer {
      const server = Bun.serve({ port, fetch });
      const boundPort = server.port ?? port;
      const url = `http://${server.hostname}:${boundPort}`;
      return {
        store,
        fetch,
        listen: () => {
          throw new Error("already listening");
        },
        url,
        port: boundPort,
        stop: () => server.stop(true),
      };
    },
  };
}
