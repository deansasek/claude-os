// Shapes of the Radio app's server answers. Imported by both sides.

export interface Station {
  id: string;        // Radio Browser station id
  name: string;
  url: string;       // the stream address; always https (web/stations.ts)
  country: string;
  codec: string;     // e.g. "MP3", "AAC"; empty when unknown
  bitrate: number;   // kbit/s; 0 when unknown
}

export type StationsResult =
  | { status: 'ok'; stations: Station[] }
  | { status: 'error'; stations: Station[]; error: string };
