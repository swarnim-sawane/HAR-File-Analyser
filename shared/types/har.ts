export interface HarEntry {
  index: number;
  startedDateTime: string;
  time: number;
  request: HarRequest;
  response: HarResponse;
  cache: HarCache;
  timings: HarTimings;
  serverIPAddress?: string;
  connection?: string;
  comment?: string;
}

export interface HarRequest {
  method: string;
  url: string;
  httpVersion: string;
  headers: HarHeader[];
  queryString: HarQueryParam[];
  cookies: HarCookie[];
  headersSize: number;
  bodySize: number;
  postData?: HarPostData;
}

export interface HarResponse {
  status: number;
  statusText: string;
  httpVersion: string;
  headers: HarHeader[];
  cookies: HarCookie[];
  content: HarContent;
  redirectURL: string;
  headersSize: number;
  bodySize: number;
}

export interface HarHeader {
  name: string;
  value: string;
}

export interface HarQueryParam {
  name: string;
  value: string;
}

export interface HarCookie {
  name: string;
  value: string;
  path?: string;
  domain?: string;
  expires?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

export interface HarPostData {
  mimeType: string;
  text?: string;
  params?: HarParam[];
}

export interface HarParam {
  name: string;
  value?: string;
  fileName?: string;
  contentType?: string;
}

export interface HarContent {
  size: number;
  compression?: number;
  mimeType: string;
  text?: string;
  encoding?: string;
}

export interface HarCache {
  beforeRequest?: HarCacheEntry;
  afterRequest?: HarCacheEntry;
}

export interface HarCacheEntry {
  expires?: string;
  lastAccess: string;
  eTag: string;
  hitCount: number;
}

export interface HarTimings {
  blocked?: number;
  dns?: number;
  connect?: number;
  send: number;
  wait: number;
  receive: number;
  ssl?: number;
}

export interface HarFile {
  log: {
    version: string;
    creator: HarCreator;
    browser?: HarBrowser;
    pages?: HarPage[];
    entries: HarEntry[];
    comment?: string;
  };
}

export interface HarCreator {
  name: string;
  version: string;
  comment?: string;
}

export interface HarBrowser {
  name: string;
  version: string;
  comment?: string;
}

export interface HarPage {
  startedDateTime: string;
  id: string;
  title: string;
  pageTimings: HarPageTimings;
  comment?: string;
}

export interface HarPageTimings {
  onContentLoad?: number;
  onLoad?: number;
  comment?: string;
}

export interface HarStats {
  totalRequests: number;
  totalSize: number;
  totalTime: number;
  avgTime: number;
  successRate: number;
  errorCount: number;
  byMethod: Record<string, number>;
  byStatus: Record<string, number>;
  byContentType: Record<string, number>;
}
