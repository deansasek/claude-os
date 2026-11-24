// Shapes of the Radio app's server answers. Imported by both sides.

export interface Station {
  id: string;        // Radio Browser station id
  name: string;
  url: string;       // the stream address; always https (web/stations.ts)
  country: string;
  codec: string;     // e.g. "MP3", "AAC"; empty when unknown
  bitrate: number;   // kbit/s; 0 when unknown
  favicon?: string;  // the station's logo, https only; empty or missing when it has none (older saved stations)
  language?: string; // e.g. "English, German"
  tags?: string[];   // genres, e.g. ["jazz", "smooth jazz"]
}

export type StationsResult =
  | { status: 'ok'; stations: Station[] }
  | { status: 'error'; stations: Station[]; error: string };

/** One genre, country or language in the directory. code is the country's ISO code (empty for the others). */
export interface Facet { name: string; code: string; count: number }

export type FacetsResult =
  | { status: 'ok'; facets: Facet[] }
  | { status: 'error'; facets: Facet[]; error: string };

/** The stream's current title (ICY metadata), or '' when the stream sends none. */
export interface TitleResult { title: string }
