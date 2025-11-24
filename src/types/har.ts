// src/types/har.ts
export interface HarLog {
  version: string;
  creator: Creator;
  browser?: Browser;
  pages?: Page[];
  entries: Entry[];
  comment?: string;
}

export interface Creator {
  name: string;
  version: string;
  comment?: string;
}

export interface Browser {
  name: string;
  version: string;
  comment?: string;
}

export interface Page {
  startedDateTime: string;
  id: string;
  title: string;
  pageTimings: PageTimings;
  comment?: string;
}

export interface PageTimings {
  onContentLoad?: number;
  onLoad?: number;
  comment?: string;
}

export interface Entry {
  pageref?: string;
  startedDateTime: string;
  time: number;
  request: Request;
  response: Response;
  cache: Cache;
  timings: Timings;
  serverIPAddress?: string;
  connection?: string;
  comment?: string;
}

export interface Request {
  method: string;
  url: string;
  httpVersion: string;
  cookies: Cookie[];
  headers: Header[];
  queryString: QueryString[];
  postData?: PostData;
  headersSize: number;
  bodySize: number;
  comment?: string;
}

export interface Response {
  status: number;
  statusText: string;
  httpVersion: string;
  cookies: Cookie[];
  headers: Header[];
  content: Content;
  redirectURL: string;
  headersSize: number;
  bodySize: number;
  comment?: string;
}

export interface Cookie {
  name: string;
  value: string;
  path?: string;
  domain?: string;
  expires?: string;
  httpOnly?: boolean;
  secure?: boolean;
  comment?: string;
}

export interface Header {
  name: string;
  value: string;
  comment?: string;
}

export interface QueryString {
  name: string;
  value: string;
  comment?: string;
}

export interface PostData {
  mimeType: string;
  params?: Param[];
  text?: string;
  comment?: string;
}

export interface Param {
  name: string;
  value?: string;
  fileName?: string;
  contentType?: string;
  comment?: string;
}

export interface Content {
  size: number;
  compression?: number;
  mimeType: string;
  text?: string;
  encoding?: string;
  comment?: string;
}

export interface Cache {
  beforeRequest?: CacheEntry;
  afterRequest?: CacheEntry;
  comment?: string;
}

export interface CacheEntry {
  expires?: string;
  lastAccess: string;
  eTag: string;
  hitCount: number;
  comment?: string;
}

export interface Timings {
  blocked?: number;
  dns?: number;
  connect?: number;
  send: number;
  wait: number;
  receive: number;
  ssl?: number;
  comment?: string;
}

export interface HarFile {
  log: HarLog;
}

export interface FilterOptions {
  statusCodes: {
    '0': boolean;
    '1xx': boolean;
    '2xx': boolean;
    '3xx': boolean;
    '4xx': boolean;
    '5xx': boolean;
  };
  groupBy: 'pages' | 'all';
  searchTerm: string;
  timingType: 'relative' | 'independent';
}
