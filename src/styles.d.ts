declare module '*.css';

declare module '*.tsv?raw' {
  const contents: string;
  export default contents;
}
