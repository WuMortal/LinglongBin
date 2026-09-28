import * as XLSX from 'xlsx'
import * as cptable from 'xlsx/dist/cpexcel.full.mjs'

XLSX.set_cptable(cptable)

const u8 = new Uint8Array(await Deno.readFile('demo/立创商城订单详情-SO26082725407.xls'))
const ZIP = [0x50,0x4b,0x03,0x04], OLE2=[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]
const starts = (u,s)=>u.length>=s.length&&s.every((b,i)=>u[i]===b)
console.log('isZIP', starts(u8,ZIP), 'isOLE2', starts(u8,OLE2))

const wb = XLSX.read(u8, { type: 'array' })
const ws = wb.Sheets[wb.SheetNames[0]]
const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
const matrix = json.map(r => (r||[]).map(x => String(x ?? '').trim()))
console.log('rows', matrix.length)
// print first 30 rows joined
for (let i=0;i<Math.min(30,matrix.length);i++){
  console.log(`ROW ${i}:`, JSON.stringify(matrix[i]))
}
