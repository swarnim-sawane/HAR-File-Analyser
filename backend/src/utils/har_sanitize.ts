// backend/src/utils/har_sanitize.ts
type HarFile = { log: { entries: any[] } };

export type PossibleScrubItems = {
    headers: string[];
    cookies: string[];
    queryArgs: string[];
    postParams: string[];
    mimeTypes: string[];
    domains: string[];
};

const defaultMimeTypesList = ['application/javascript', 'text/javascript'];

const defaultWordList = [
    'Authorization',
    'SAMLRequest',
    'SAMLResponse',
    'access_token',
    'appID',
    'assertion',
    'auth',
    'authenticity_token',
    'challenge',
    'client_id',
    'client_secret',
    'code',
    'code_challenge',
    'code_verifier',
    'email',
    'facetID',
    'fcParams',
    'id_token',
    'password',
    'refresh_token',
    'serverData',
    'shdf',
    'state',
    'token',
    'usg',
    'vses2',
    'x-client-data',
];

export const defaultScrubItems = [...defaultMimeTypesList, ...defaultWordList];

// The default list of regexes that aren't word dependent
const defaultRegex = [
    [
        {
            // Redact signature on JWTs
            regex: new RegExp(
                `\\b(ey[A-Za-z0-9-_=]+)\\.(ey[A-Za-z0-9-_=]+)\\.[A-Za-z0-9-_.+/=]+\\b`,
                'g'
            ),
            replacement: `$1.$2.redacted`,
        },
    ],
];

function buildRegex(word: string) {
    // Escape any regex-special chars in the dynamic word
    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const w = escapeRegex(word);

    return [
        {
            // [full word]=[capture]
            regex: new RegExp(
                '([\\s";,&?]+' + w + '=)([\\w+\\-_/=#|.%&:!*()`~\\\'"]+?)(&|\\\\",|",|"\\s|"}}|;){1}',
                'g'
            ),
            replacement: `$1[${word} redacted]$3`,
        },
        {
            // Set up this way in case "value" isn't directly after "name"
            regex: new RegExp(
                '("name": "' + w + '",[\\s\\w+:"-\\%!*()`~\\\'.,#]*?"value": ")((?:\\\\\\"|[^"])*)(")',
                'g'
            ),
            replacement: `$1[${word} redacted]$3`,
        },
        {
            // "name" comes after "value"
            regex: new RegExp(
                '("value": ")([\\w+\\-_:&+=#$~/()\\\\.\\,*!|%"\\s;]+)("[,\\s}}]+)([\\s\\w+:"-\\\\%!*\\()`~\\\'#.]*"name": "' +
                w +
                '")',
                'g'
            ),
            replacement: `$1[${word} redacted]$3$4`,
        },
    ];
}

function removeContentForMimeTypes(input: string, scrubList: string[]) {
    const harJSON = JSON.parse(input);
    const entries = harJSON.log.entries;

    if (!entries) {
        throw new Error('failed to find entries in HAR file');
    }

    for (const entry of entries) {
        const response = entry.response;
        if (response && scrubList.includes(response.content.mimeType)) {
            response.content.text = `[${response.content.mimeType} redacted]`;
        }
    }

    return JSON.stringify(harJSON, null, 2);
}

export function getHarInfo(input: string): PossibleScrubItems {
    const output = {
        headers: new Set<string>(),
        queryArgs: new Set<string>(),
        cookies: new Set<string>(),
        postParams: new Set<string>(),
        mimeTypes: new Set<string>(),
        domains: new Set<string>(),
    };

    const harJSON: HarFile = JSON.parse(input);
    const entries = harJSON.log.entries;

    if (!entries) {
        throw new Error('failed to find entries in HAR file');
    }

    for (const entry of entries) {
        const response = entry.response;
        response?.headers?.forEach((header: any) => output.headers.add(header.name));
        response?.cookies?.forEach((cookie: any) => output.cookies.add(cookie.name));
        if (response?.content?.mimeType) output.mimeTypes.add(response.content.mimeType);

        const request = entry.request;
        request?.headers?.forEach((header: any) => output.headers.add(header.name));
        request?.queryString?.forEach((arg: any) => output.queryArgs.add(arg.name));
        request?.cookies?.forEach((cookie: any) => output.cookies.add(cookie.name));

        if (request.postData) {
            request.postData.params?.map((param: any) => output.postParams.add(param.name));
        }

        // Extract hostname from each request URL
        try {
            const hostname = new URL(request.url).hostname;
            if (hostname) output.domains.add(hostname);
        } catch {
            // ignore malformed URLs
        }
    }

    return {
        headers: [...output.headers].sort(),
        queryArgs: [...output.queryArgs].sort(),
        cookies: [...output.cookies].sort(),
        postParams: [...output.postParams].sort(),
        mimeTypes: [...output.mimeTypes].sort(),
        domains: [...output.domains].sort(),
    };
}

function getScrubMimeTypes(
    options?: SanitizeOptions,
    possibleScrubItems?: PossibleScrubItems
) {
    if (options?.allMimeTypes && !!possibleScrubItems) {
        return possibleScrubItems.mimeTypes;
    }

    return options?.scrubMimetypes || defaultMimeTypesList;
}

function getScrubWords(
    options?: SanitizeOptions,
    possibleScrubItems?: PossibleScrubItems
) {
    let scrubWords = options?.scrubWords || [];

    if (options?.allCookies && !!possibleScrubItems) {
        scrubWords = scrubWords.concat(possibleScrubItems.cookies);
    }

    if (options?.allHeaders && !!possibleScrubItems) {
        scrubWords = scrubWords.concat(possibleScrubItems.headers);
    }

    if (options?.allQueryArgs && !!possibleScrubItems) {
        scrubWords = scrubWords.concat(possibleScrubItems.queryArgs);
    }

    if (options?.allPostParams && !!possibleScrubItems) {
        scrubWords = scrubWords.concat(possibleScrubItems.postParams);
    }

    return scrubWords.length > 0 ? scrubWords : defaultWordList;
}

export type SanitizeOptions = {
    scrubWords?: string[];
    scrubMimetypes?: string[];
    scrubDomains?: string[];
    allCookies?: boolean;
    allHeaders?: boolean;
    allQueryArgs?: boolean;
    allMimeTypes?: boolean;
    allPostParams?: boolean;
};

/**
 * Replace selected domain names throughout the HAR structure:
 * - entry.request.url
 * - entry.request.headers[*].value  (Host, Origin, Referer, etc.)
 * - entry.response.redirectURL
 * - entry.response.headers[*].value (Location, etc.)
 * - page titles (if present)
 */
function redactDomainsInHar(input: string, domains: string[]): string {
    if (!domains.length) return input;

    const harJSON = JSON.parse(input);
    const entries: any[] = harJSON.log?.entries ?? [];

    const replaceAll = (s: string): string => {
        for (const domain of domains) {
            s = s.split(domain).join('[domain redacted]');
        }
        return s;
    };

    for (const entry of entries) {
        if (entry.request?.url) {
            entry.request.url = replaceAll(entry.request.url);
        }
        if (Array.isArray(entry.request?.headers)) {
            for (const h of entry.request.headers) {
                if (typeof h.value === 'string') h.value = replaceAll(h.value);
            }
        }
        if (typeof entry.response?.redirectURL === 'string') {
            entry.response.redirectURL = replaceAll(entry.response.redirectURL);
        }
        if (Array.isArray(entry.response?.headers)) {
            for (const h of entry.response.headers) {
                if (typeof h.value === 'string') h.value = replaceAll(h.value);
            }
        }
    }

    const pages: any[] = harJSON.log?.pages ?? [];
    for (const page of pages) {
        if (typeof page.title === 'string') page.title = replaceAll(page.title);
    }

    return JSON.stringify(harJSON, null, 2);
}

export function sanitize(input: string, options?: SanitizeOptions): string {
    let possibleScrubItems: PossibleScrubItems | undefined;

    if (
        options?.allCookies ||
        options?.allHeaders ||
        options?.allMimeTypes ||
        options?.allQueryArgs ||
        options?.allPostParams
    ) {
        // Parse the HAR to get the full list of things we could scrub
        possibleScrubItems = getHarInfo(input);
    }

    // Remove specific mime responses first
    input = removeContentForMimeTypes(
        input,
        getScrubMimeTypes(options, possibleScrubItems)
    );

    // Trim the list of words we are looking for down to the ones actually in the HAR file
    const wordList = getScrubWords(options, possibleScrubItems).filter((val) =>
        input.includes(val)
    );

    // Build list of regexes needed to actually scrub the file
    const wordSpecificScrubList = wordList.map((word) => buildRegex(word));
    const allScrubList = defaultRegex.concat(wordSpecificScrubList);

    for (const scrubList of allScrubList) {
        for (const scrub of scrubList) {
            input = input.replace(scrub.regex, scrub.replacement);
        }
    }

    // Redact selected domain names from URLs and relevant headers
    if (options?.scrubDomains?.length) {
        input = redactDomainsInHar(input, options.scrubDomains);
    }

    return input;
}
