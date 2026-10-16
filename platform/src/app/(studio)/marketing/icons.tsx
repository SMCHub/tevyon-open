/**
 * The Marketing Agent's own glyphs: one stroke weight on a 24 grid, plain shapes, one meaning each (no two areas share
 * a symbol). Lucide icons elsewhere on the page are set to the same stroke in marketing.css, so both read as one set.
 */
type P = { className?: string };

function Svg({ className, children }: P & { children: React.ReactNode }) {
  return (
    <svg
      className={className ? `ma-glyph ${className}` : "ma-glyph"}
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Start: the overview of templates and the builder. */
export const GHome = (p: P) => <Svg {...p}><path d="M4.5 10.2 12 4l7.5 6.2V20h-15z" /><path d="M10 20v-5.5h4V20" /></Svg>;
/** Plan campaign: a conversation with the agent. */
export const GAgent = (p: P) => (
  <Svg {...p}>
    <path d="M5.5 5h13A1.5 1.5 0 0 1 20 6.5v8.5a1.5 1.5 0 0 1-1.5 1.5H10l-4 3.5v-3.5h-.5A1.5 1.5 0 0 1 4 15V6.5A1.5 1.5 0 0 1 5.5 5z" />
    <path d="M8 9.5h8M8 12.5h5" />
  </Svg>
);
/** Meine Generierungen: a stack of results. */
export const GStack = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="7.5" width="13" height="13" rx="1.5" />
    <path d="M7.5 7.5V5A1.5 1.5 0 0 1 9 3.5h10A1.5 1.5 0 0 1 20.5 5v10a1.5 1.5 0 0 1-1.5 1.5h-2.5" />
    <path d="m3.8 17.8 3.7-3.7 3 3 1.6-1.6 4.1 4.1" />
  </Svg>
);
/** Favoriten. */
export const GStar = (p: P) => <Svg {...p}><path d="M12 4.1 13.91 9.97h6.17l-4.99 3.63 1.9 5.88L12 15.85l-5 3.63 1.91-5.88-4.99-3.63h6.17z" /></Svg>;
/** Products & product link: the box that goes into the picture. */
export const GBox = (p: P) => <Svg {...p}><path d="M12 3.5 19.5 7.75v8.5L12 20.5l-7.5-4.25v-8.5z" /><path d="M4.5 7.75 12 12l7.5-4.25M12 12v8.5" /></Svg>;
/** Anzeigen-Referenzen: a saved ad, marked with a bookmark. */
export const GReference = (p: P) => <Svg {...p}><rect x="4" y="3.5" width="16" height="17" rx="1.5" /><path d="M13.5 3.5v6l2-1.5 2 1.5v-6M7.5 16.5h6" /></Svg>;
/** Projekte. */
export const GFolder = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h4l2 2h8A1.5 1.5 0 0 1 20.5 9v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z" />
    <path d="M3.5 11h17" />
  </Svg>
);
export const GPlus = (p: P) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const GSearch = (p: P) => <Svg {...p}><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" /></Svg>;
/** Sortieren: lines getting shorter. */
export const GSort = (p: P) => <Svg {...p}><path d="M4 7h16M4 12h10.5M4 17h6" /></Svg>;
/** The sidebar itself, with the way it would move. */
export const GPanel = ({ open, ...p }: P & { open: boolean }) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <path d="M9.5 4.5v15" />
    <path d={open ? "m15.5 10-2 2 2 2" : "m13.5 10 2 2-2 2"} />
  </Svg>
);
export const GClose = (p: P) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>;
export const GChevron = (p: P) => <Svg {...p}><path d="m7 10 5 5 5-5" /></Svg>;
export const GPin = (p: P) => <Svg {...p}><path d="M9 4.5h6M10 4.5l-.8 7L6.5 14h11l-2.7-2.5-.8-7M12 14v6" /></Svg>;
export const GMenu = (p: P) => <Svg {...p}><path d="M4 7h16M4 12h16M4 17h10" /></Svg>;
export const GArrow = (p: P) => <Svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;

/* Template categories */
/** UGC: a person who speaks about the product. */
export const GPerson = (p: P) => <Svg {...p}><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c.8-3.8 3.6-6 7-6s6.2 2.2 7 6" /></Svg>;
/** Produktfoto: the camera. */
export const GCamera = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 7.5h3L9 5h6l1.5 2.5h3A1.5 1.5 0 0 1 21 9v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V9a1.5 1.5 0 0 1 1.5-1.5z" />
    <circle cx="12" cy="13" r="3.5" />
  </Svg>
);
/** Anzeigen: the megaphone. */
export const GMegaphone = (p: P) => <Svg {...p}><path d="M4 10v4a1 1 0 0 0 1 1h2l8 4.5v-15L7 9H5a1 1 0 0 0-1 1z" /><path d="M18.5 9.5a3.5 3.5 0 0 1 0 5M8 15.5l1.2 4" /></Svg>;
/** Poster: a sheet with its headline. */
export const GPoster = (p: P) => <Svg {...p}><rect x="5" y="3" width="14" height="18" rx="1" /><path d="M8 7h8M8 10h5M8 17h4" /></Svg>;
/** Marktplatz: the shopping bag. */
export const GBag = (p: P) => <Svg {...p}><path d="M5.5 8h13l-1 11.5a1 1 0 0 1-1 .9h-9a1 1 0 0 1-1-.9z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" /></Svg>;
/** Motion: the product in motion. */
export const GPlay = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M10.2 8.8v6.4l5-3.2z" /></Svg>;

/* Media and list views */
export const GImage = (p: P) => <Svg {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="1.5" /><circle cx="9" cy="9.5" r="1.5" /><path d="m4 17.5 5-5 4 4 2.5-2.5 4.5 4.5" /></Svg>;
export const GVideo = (p: P) => <Svg {...p}><rect x="3" y="6" width="13" height="12" rx="1.5" /><path d="m16 10.5 5-3v9l-5-3" /></Svg>;
/** Large cards: two tall frames, as the template's grid toggle. */
export const GCardsLarge = (p: P) => <Svg {...p}><rect x="4" y="5" width="7" height="14" rx="1.5" /><rect x="13" y="5" width="7" height="14" rx="1.5" /></Svg>;
export const GCardsSmall = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" />
  </Svg>
);
