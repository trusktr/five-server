/**
 * @author    Yannick Deubel (https://github.com/yandeu)
 * @copyright Copyright (c) 2021 Yannick Deubel
 * @license   {@link https://github.com/yandeu/five-server/blob/main/LICENSE LICENSE}
 */

import type { NextFunction, Request, Response } from 'express6'
import { createReadStream, existsSync, fstat, statSync } from 'fs'
import { extname, join, resolve } from 'path'
import { Writable } from 'stream'
import { unzip as _unzip } from 'zlib'
import url from 'url'

/**
 * unzip: Decompress either a Gzip- or Deflate-compressed stream by auto-detecting the header.
 * https://nodejs.org/api/zlib.html#zlib_class_zlib_unzip
 */
const unzip = (buffer: Buffer): Promise<string> => {
  return new Promise((resolve, reject) => {
    _unzip(buffer, (err: Error | null, buffer: Buffer) => {
      if (err) return reject(err)
      return resolve(buffer.toString())
    })
  })
}

export class Inject extends Writable {
  size: number = 0
  chunks: Buffer[] = []
  data = ''
  injectTag = ''

  constructor(public tags, public code) {
    super()
  }

  doInjection(data: string) {
    const injectCandidates = [new RegExp('</head>', 'i'), new RegExp('</html>', 'i'), new RegExp('</body>', 'i')]
    let match

    for (let i = 0; i < injectCandidates.length; ++i) {
      match = injectCandidates[i].exec(data)
      if (match) {
        this.injectTag = match[0]
        break
      }
    }

    if (this.injectTag) {
      data = data.replace(this.injectTag, this.code + this.injectTag)
    } else {
      data = data + '\n' + this.code
    }

    // convert cache to [src|href]="/.cache/.."
    const replacer = (match, p1, p2, _offset, _string) =>
      match.replace(p1, '').replace(p2, `/.cache/${p2.replace(/^\//, '')}`)
    data = data.replace(/<[^>]*(cache.)[^>]*[src|href]="(\S+)"[^>]*>/gm, replacer)

    this.data = data
  }

  _write(chunk: Buffer, encoding: BufferEncoding, callback) {
    this.chunks.push(chunk)
    callback()
  }

  async _final(callback) {
    const buffer = Buffer.concat(this.chunks)
    this.data = buffer.toString()

    const raw = await unzip(buffer).catch(() => {})
    if (raw) this.data = raw

    this.doInjection(this.data)
    callback()
  }
}

export const code = (filePath: string, baseURL: string, injectBodyOptions: boolean) => {
  const a = injectBodyOptions ? ' data-inject-body="true"' : ''
  return `<!-- Code injected by Five-server -->
  <script async data-id="five-server" data-file="${filePath}"${a} type="application/javascript" src="${baseURL}fiveserver.js"></script>
  `
}

/** Injects the five-server script into the html page and converts the cache attributes. */
export const injectCode = (root: string, baseURL: string, PHP: any, injectBodyOptions: boolean) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { pathname } = url.parse(req.url)

    if (
      pathname &&
      (pathname === '/' ||
        extname(pathname) === '.html' ||
        extname(pathname) === '.htm' ||
        extname(pathname) === '.php')
    ) {
      let filePath = resolve(join(root + pathname))
      filePath = decodeURI(filePath)

      if (!existsSync(filePath)) return next()
      if (!statSync(filePath).isFile()) return next()

      const inject = new Inject(['</head>', '</html>', '</body>'], code(filePath, baseURL, injectBodyOptions))

      if (extname(pathname) === '.php') {
        const html = await PHP.parseFile(filePath, res)
        inject.doInjection(html)
        res.type('html')
        res.setHeader('Content-Length', inject.data.length)
        return res.send(inject.data)
      }

      createReadStream(filePath)
        .pipe(inject)
        .on('finish', () => {
          res.type('html')
          res.setHeader('Content-Length', inject.data.length)
          res.send(inject.data)
        })
        .on('error', () => {
          return next()
        })
    } else {
      return next()
    }
  }
}
