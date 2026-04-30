declare module 'encoding-japanese' {
  export interface EncodingConvertOptions {
    to: string
    from?: string
    type?: 'string' | 'array' | 'arraybuffer'
  }

  export interface Encoding {
    convert(data: string, options: EncodingConvertOptions): unknown
  }

  const Encoding: Encoding
  export default Encoding
}
