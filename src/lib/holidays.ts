/**
 * 中国法定节假日静态数据（国务院办公厅年度放假安排）。
 * 2026：国办发明电〔2025〕7号（2025-11-04 发布）。
 * 2027：官方安排一般每年 11 月发布，尚未公布 → 空数据兜底（仅按周末判断），
 *       年度「节假日清单」自动化每年 11 月更新此处后重新部署。
 */
export interface HolidayYearData {
  /** 放假日（法定节假日 + 调休连休），yyyy-MM-dd */
  holidays: string[]
  /** 调休上班日（周末但需上班），yyyy-MM-dd */
  makeupWorkdays: string[]
  /** 节假日名称（展示用），key = yyyy-MM-dd */
  names: Record<string, string>
}

export const HOLIDAY_DATA: Record<number, HolidayYearData> = {
  2026: {
    holidays: [
      // 元旦：1/1(四)-1/3(六)，1/4(日)上班
      '2026-01-01', '2026-01-02', '2026-01-03',
      // 春节：2/15(日)-2/23(一)，2/14(六)、2/28(六)上班
      ...range('2026-02-15', '2026-02-23'),
      // 清明：4/4(六)-4/6(一)
      '2026-04-04', '2026-04-05', '2026-04-06',
      // 劳动节：5/1(五)-5/5(二)，5/9(六)上班
      ...range('2026-05-01', '2026-05-05'),
      // 端午：6/19(五)-6/21(日)
      '2026-06-19', '2026-06-20', '2026-06-21',
      // 中秋：9/25(五)-9/27(日)
      '2026-09-25', '2026-09-26', '2026-09-27',
      // 国庆：10/1(四)-10/7(三)，9/20(日)、10/10(六)上班
      ...range('2026-10-01', '2026-10-07'),
    ],
    makeupWorkdays: ['2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10'],
    names: {
      '2026-01-01': '元旦', '2026-01-02': '元旦', '2026-01-03': '元旦',
      ...Object.fromEntries(range('2026-02-15', '2026-02-23').map((d) => [d, '春节'])),
      '2026-04-04': '清明', '2026-04-05': '清明', '2026-04-06': '清明',
      ...Object.fromEntries(range('2026-05-01', '2026-05-05').map((d) => [d, '劳动节'])),
      '2026-06-19': '端午', '2026-06-20': '端午', '2026-06-21': '端午',
      '2026-09-25': '中秋', '2026-09-26': '中秋', '2026-09-27': '中秋',
      ...Object.fromEntries(range('2026-10-01', '2026-10-07').map((d) => [d, '国庆'])),
    },
  },
}

/** 生成起闭区间内的日期串（yyyy-MM-dd），入参必须是 yyyy-MM-dd 格式 */
function range(start: string, end: string): string[] {
  const out: string[] = []
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end + 'T00:00:00')
  for (let d = s; d <= e; d.setDate(d.getDate() + 1)) {
    out.push(toDateStrLocal(d))
  }
  return out
}

/** 本地时区 yyyy-MM-dd（避免 toISOString 的 UTC 偏移） */
function toDateStrLocal(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** 某年的节假日数据（无数据的年份返回空集，按周末兜底） */
export function holidayDataOf(year: number): HolidayYearData {
  return HOLIDAY_DATA[year] ?? { holidays: [], makeupWorkdays: [], names: {} }
}
