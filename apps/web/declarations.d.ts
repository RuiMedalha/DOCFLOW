declare module 'papaparse' {
  export interface ParseConfig {
    delimiter?: string;
    newline?: string;
    quoteChar?: string;
    escapeChar?: string;
    header?: boolean;
    preview?: number;
    dynamicTyping?: boolean;
    encoding?: string;
    complete?: (results: ParseResult<any>, file?: any) => void;
    error?: (error: any, file?: any) => void;
    skipEmptyLines?: boolean | 'greedy';
  }

  export interface ParseResult<T = any> {
    data: T[];
    errors: any[];
    meta: {
      delimiter: string;
      linebreak: string;
      aborted: boolean;
      truncated: boolean;
      cursor: number;
      fields?: string[];
    };
  }

  export function parse<T = any>(fileOrString: any, config?: ParseConfig): ParseResult<T>;
  export function unparse(data: any[] | any, config?: any): string;

  const Papa: {
    parse: typeof parse;
    unparse: typeof unparse;
  };

  export default Papa;
}
