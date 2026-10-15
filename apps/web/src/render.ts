import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";

let toolkit: Promise<VerovioToolkit> | null = null;

function getToolkit() {
  toolkit ??= createVerovioModule().then((m: unknown) => new VerovioToolkit(m as never));
  return toolkit;
}

export async function renderMusicXML(xml: string, pageWidth: number): Promise<string> {
  const tk = await getToolkit();
  tk.setOptions({
    pageWidth: Math.max(600, Math.round(pageWidth * 2.2)),
    scale: 45,
    adjustPageHeight: true,
    pageMarginLeft: 30,
    pageMarginRight: 30,
    footer: "none",
  });
  tk.loadData(xml);
  return tk.renderToSVG(1);
}
