// Public API for @liebstoeckel/buncus-mock-github.
//
//   import { createMockGitHub } from "@liebstoeckel/buncus-mock-github";
//   const mock = createMockGitHub();          // in-process, no port
//   const res = await mock.fetch(new Request("http://gh/graphql", { ... }));
//
//   const mock = createMockGitHub().listen(0); // real Bun.serve on a port
//   // point buncus at it:  GITHUB_API_HOST = GITHUB_OAUTH_HOST = mock.url
//
// `mock.store` is the live in-memory state — seed extra repos/users/discussions
// before driving a flow, or assert against it after.

import { handleRequest } from "./handler.ts";
import { resetIds, Store, type StoreOptions } from "./store.ts";

export type {
  Category,
  Comment,
  Discussion,
  ReactionContent,
  Repo,
  User,
} from "./store.ts";
export type { StoreOptions };
export { resetIds, Store };

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
