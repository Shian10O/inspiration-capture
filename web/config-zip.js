// A single stored ZIP entry, compatible with HTTP Shortcuts' shortcuts.json import.
// Built in memory so device credentials need not be written to a public URL.
export function configZip(config) {
 const name=new TextEncoder().encode('shortcuts.json'),data=new TextEncoder().encode(JSON.stringify(config));
 let crc=0xffffffff;
 for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
 crc=(crc^0xffffffff)>>>0;
 const local=30+name.length,central=46+name.length,out=new Uint8Array(local+data.length+central+22),v=new DataView(out.buffer);
 const u16=(p,n)=>v.setUint16(p,n,true),u32=(p,n)=>v.setUint32(p,n,true);
 u32(0,0x04034b50);u16(4,20);u16(6,0x800);u16(12,33);u32(14,crc);u32(18,data.length);u32(22,data.length);u16(26,name.length);
 out.set(name,30);out.set(data,local);
 const c=local+data.length;
 u32(c,0x02014b50);u16(c+4,20);u16(c+6,20);u16(c+8,0x800);u16(c+14,33);u32(c+16,crc);u32(c+20,data.length);u32(c+24,data.length);u16(c+28,name.length);out.set(name,c+46);
 const end=c+central;
 u32(end,0x06054b50);u16(end+8,1);u16(end+10,1);u32(end+12,central);u32(end+16,c);
 return out;
}
