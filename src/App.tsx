import { Brain, Github } from "lucide-react";
import { SentinelMemory } from "./SentinelMemory";
import { DeploymentInfo } from "./DeploymentInfo";

const REPO_URL = "https://github.com/EzraNahumury/Sentinel";

function App() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 bg-[var(--color-nav)] text-white">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Brain className="h-5 w-5" />
            SentinelMem
            <span className="hidden text-xs font-normal text-white/50 sm:inline">
              · verifiable agent memory on Walrus
            </span>
          </h1>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-white/70 transition hover:text-white"
          >
            <Github className="h-4 w-4" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="mx-auto max-w-3xl">
          <SentinelMemory />
        </div>
      </main>

      <DeploymentInfo />
    </div>
  );
}

export default App;
