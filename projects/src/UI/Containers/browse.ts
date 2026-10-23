import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { ProjectBrowser } from "../../App/browse.ts";
import { browseMenu, type BrowseMenu } from "../Components/browse.ts";

/** Also settle locally when a host forwards native selects but ignores signal. */
function select(ui: ExtensionUIContext, menu: BrowseMenu, signal: AbortSignal): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); resolve(undefined); };
    if (signal.aborted) { resolve(undefined); return; }
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => {
      if (!signal.aborted) return ui.select(menu.title, menu.options.map(option => option.label), { signal });
    }).then(value => {
      signal.removeEventListener("abort", abort); resolve(value);
    }, error => {
      signal.removeEventListener("abort", abort); reject(error);
    });
  });
}

/** All interaction stays on the native select surface supported by both hosts. */
export async function browseProjects(browser: ProjectBrowser, ui: ExtensionUIContext): Promise<void> {
  try {
    while (!browser.signal.aborted) {
      const menu = browseMenu(browser.view);
      const selected = await select(ui, menu, browser.signal);
      if (browser.signal.aborted) break;
      const action = selected === undefined ? { kind: "back" as const }
        : menu.options.find(option => option.label === selected)?.action;
      if (!action) return; // Do not trust an answer not offered by this menu.
      await browser.dispatch(action);
    }
  } catch (error) {
    if (!browser.signal.aborted) throw error;
  } finally {
    browser.stop();
  }
}
