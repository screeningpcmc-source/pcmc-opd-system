import { toJpeg } from 'html-to-image';

export async function exportElementAsJpeg(
  element: HTMLElement,
  filename: string
): Promise<void> {
  const baseOptions = {
    backgroundColor: '#ffffff',
    pixelRatio: 2,
    quality: 0.95,
    filter: (node: HTMLElement) => {
      if (node instanceof HTMLElement && node.classList.contains('no-print')) {
        return false;
      }
      return true;
    },
  };

  let dataUrl: string;
  try {
    dataUrl = await toJpeg(element, baseOptions);
  } catch {
    // Fallback skipping remote Google Fonts CSS if CORS blocks font inlining
    dataUrl = await toJpeg(element, {
      ...baseOptions,
      skipFonts: true,
    });
  }

  const link = document.createElement('a');
  link.download = filename.endsWith('.jpeg') || filename.endsWith('.jpg') ? filename : `${filename}.jpeg`;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
