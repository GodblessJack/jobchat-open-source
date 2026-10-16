// Type declaration for multer — the @types/multer package is not installed.
declare module 'multer' {
  import { Request, RequestHandler } from 'express';

  interface File {
    fieldname: string;
    originalname: string;
    encoding: string;
    mimetype: string;
    size: number;
    destination: string;
    filename: string;
    path: string;
    buffer: Buffer;
  }

  // declare class so it's usable as both a type AND a runtime value (instanceof)
  class MulterError extends Error {
    code: string;
    field?: string;
  }

  interface Options {
    storage?: any;
    limits?: {
      fieldNameSize?: number;
      fieldSize?: number;
      fields?: number;
      fileSize?: number;
      files?: number;
      parts?: number;
      headerPairs?: number;
    };
    fileFilter?: (req: Request, file: File, cb: (error: Error | null, acceptFile: boolean) => void) => void;
  }

  function multer(options?: Options): {
    single(fieldname: string): RequestHandler;
    array(fieldname: string, maxCount?: number): RequestHandler;
    fields(fields: Array<{ name: string; maxCount?: number }>): RequestHandler;
    none(): RequestHandler;
  };

  namespace multer {
    export function diskStorage(opts: {
      destination?: string | ((req: Request, file: File, cb: (error: Error | null, destination: string) => void) => void);
      filename?: (req: Request, file: File, cb: (error: Error | null, filename: string) => void) => void;
    }): any;
  }

  export { File, MulterError, Options };
  export default multer;
}

// Augment Express Request to recognise multer's .file property
declare global {
  namespace Express {
    interface Request {
      file?: import('multer').File;
    }
  }
}
