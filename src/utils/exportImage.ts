import { toJpeg } from 'html-to-image';

export async function exportElementAsJpeg(
  element: HTMLElement,
  filename: string
): Promise<void> {
  const scrollContainers: Array<{ el: HTMLElement; prevOverflowX: string; prevOverflow: string }> = [];
  const collectScrollable = (el: HTMLElement) => {
    const cs = window.getComputedStyle(el);
    if (
      cs.overflowX === 'auto' ||
      cs.overflowX === 'scroll' ||
      el.classList.contains('overflow-x-auto') ||
      el.classList.contains('print-fit-container')
    ) {
      scrollContainers.push({
        el,
        prevOverflowX: el.style.overflowX,
        prevOverflow: el.style.overflow,
      });
      el.style.overflowX = 'visible';
      el.style.overflow = 'visible';
    }
  };
  collectScrollable(element);
  element.querySelectorAll<HTMLElement>('.overflow-x-auto, .print-fit-container').forEach(collectScrollable);

  const captureWidth = Math.max(element.scrollWidth, element.clientWidth);
  const captureHeight = Math.max(element.scrollHeight, element.clientHeight);

  const baseOptions = {
    backgroundColor: '#ffffff',
    pixelRatio: 2,
    quality: 0.95,
    width: captureWidth,
    height: captureHeight,
    style: {
      margin: '0',
      overflow: 'visible',
    },
    filter: (node: HTMLElement) => {
      if (node instanceof HTMLElement && node.classList.contains('no-print')) {
        return false;
      }
      return true;
    },
  };

  let dataUrl: string;
  try {
    try {
      dataUrl = await toJpeg(element, baseOptions);
    } catch {
      // Fallback skipping remote Google Fonts CSS if CORS blocks font inlining
      dataUrl = await toJpeg(element, {
        ...baseOptions,
        skipFonts: true,
      });
    }
  } finally {
    scrollContainers.forEach(({ el, prevOverflowX, prevOverflow }) => {
      el.style.overflowX = prevOverflowX;
      el.style.overflow = prevOverflow;
    });
  }

  const link = document.createElement('a');
  link.download = filename.endsWith('.jpeg') || filename.endsWith('.jpg') ? filename : `${filename}.jpeg`;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
