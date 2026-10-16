declare module 'multicast-dns' {
  interface MulticastDNS {
    on(event: string, listener: (...args: any[]) => void): void;
    query(packet: any): void;
    destroy(): void;
  }
  function makeMdns(opts?: any): MulticastDNS;
  export default makeMdns;
}
