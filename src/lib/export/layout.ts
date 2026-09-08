/* Оформление обоих листов. Собрано отдельно от данных: здесь только запросы
   к Sheets API, ни одной строки из базы. */

interface Color {
  red: number;
  green: number;
  blue: number;
}

const HEADER_BG: Color = { red: 0.216, green: 0.278, blue: 0.31 };
const HEADER_FG: Color = { red: 1, green: 1, blue: 1 };

// Строка без контакта — брак: связаться с человеком нечем.
const NO_CONTACT_BG: Color = { red: 0.988, green: 0.91, blue: 0.902 };
const NO_CONTACT_FG: Color = { red: 0.6, green: 0.11, blue: 0.11 };
// Заявка за последние сутки — то, ради чего в таблицу и заходят.
const FRESH_BG: Color = { red: 0.902, green: 0.957, blue: 0.918 };
// Заявок больше одной — человек возвращался.
const REPEAT_BG: Color = { red: 0.91, green: 0.941, blue: 0.996 };
// Первая строка каждого человека на листе событий — чтобы блоки не слипались.
const PERSON_START_BG: Color = { red: 0.945, green: 0.953, blue: 0.957 };

/* Ширины колонок заданы, а не подобраны автоматически. autoResize меряет
   самую широкую ячейку, а шапку в расчёт не берёт: в «Дате первой заявки»
   лежит короткое «08.09.2026», колонка сжималась под него, и заголовок
   обрезался до «ата первой заявк». Сверху на заголовок ещё налезает кнопка
   фильтра — ей нужно около трёх десятков точек. Схема листов постоянная,
   так что ширины проще задать один раз: заодно раскладка перестаёт прыгать
   от выгрузки к выгрузке, а руководитель каждый день видит одно и то же. */
const LEAD_WIDTHS = [170, 170, 175, 115, 130, 210, 240, 105, 95, 190];
const EVENT_WIDTHS = [150, 170, 115, 175, 130, 150, 560];

function gridRange(sheetId: number, startRow: number, endRow: number, startCol: number, endCol: number) {
  return {
    sheetId,
    startRowIndex: startRow,
    endRowIndex: endRow,
    startColumnIndex: startCol,
    endColumnIndex: endCol,
  };
}

function numberFormat(sheetId: number, dataRows: number, column: number, type: string, pattern?: string) {
  return {
    repeatCell: {
      // Только строки с данными: формат даты на шапке превратил бы её
      // заголовок в 30.12.1899.
      range: gridRange(sheetId, 1, 1 + dataRows, column, column + 1),
      cell: { userEnteredFormat: { numberFormat: { type, ...(pattern ? { pattern } : {}) } } },
      fields: "userEnteredFormat.numberFormat",
    },
  };
}

function conditionalRule(range: object, formula: string, background: Color, foreground?: Color) {
  return {
    addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [range],
        booleanRule: {
          condition: { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: formula }] },
          format: {
            backgroundColor: background,
            ...(foreground ? { textFormat: { foregroundColor: foreground } } : {}),
          },
        },
      },
    },
  };
}

/* Сетку подгоняем под данные до записи: значения за пределы rowCount не
   пишутся, а лишние пустые строки снизу попадают под фильтр и мешают. */
export function resizeRequest(sheetId: number, dataRows: number, columns: number) {
  return {
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: {
          // Лист не может быть пустым совсем — оставляем шапку и строку под ней.
          rowCount: Math.max(dataRows + 1, 2),
          columnCount: columns,
          frozenRowCount: 1,
        },
      },
      fields: "gridProperties(rowCount,columnCount,frozenRowCount)",
    },
  };
}

/* Прежние правила и фильтр надо снять руками: addConditionalFormatRule и
   setBasicFilter не заменяют старое, а добавляют поверх, и за десяток
   выгрузок лист обрастает копиями одного и того же правила. */
export function cleanupRequests(sheetId: number, ruleCount: number, hasFilter: boolean): unknown[] {
  const requests: unknown[] = [];

  // С конца: удаление правила сдвигает индексы всех, что стоят за ним.
  for (let index = ruleCount - 1; index >= 0; index -= 1) {
    requests.push({ deleteConditionalFormatRule: { sheetId, index } });
  }

  if (hasFilter) requests.push({ clearBasicFilter: { sheetId } });

  return requests;
}

function columnWidths(sheetId: number, widths: number[]): unknown[] {
  return widths.map((pixelSize, index) => ({
    updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: index, endIndex: index + 1 },
      properties: { pixelSize },
      fields: "pixelSize",
    },
  }));
}

function commonRequests(sheetId: number, dataRows: number, columns: number, widths: number[]): unknown[] {
  return [
    {
      repeatCell: {
        range: gridRange(sheetId, 0, 1, 0, columns),
        cell: {
          userEnteredFormat: {
            backgroundColor: HEADER_BG,
            textFormat: { bold: true, foregroundColor: HEADER_FG },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
      },
    },
    ...columnWidths(sheetId, widths),
    {
      setBasicFilter: {
        filter: { range: gridRange(sheetId, 0, 1 + dataRows, 0, columns) },
      },
    },
  ];
}

/* Лист «Заявки»: 10 колонок, A..J.
   A — дата первой заявки, C — контакт, I — заявок, J — дата последней. */
export function leadRequests(sheetId: number, dataRows: number, columns: number): unknown[] {
  const requests: unknown[] = [];

  if (dataRows > 0) {
    /* В ячейке лежит дата со временем, а формат показывает только день.
       Так и в колонке стоит «08.09.2026», как просили, и подсветка «за
       последние сутки» считает ровно сутки, а не «вчера или сегодня». */
    requests.push(numberFormat(sheetId, dataRows, 0, "DATE", "dd.mm.yyyy"));
    requests.push(numberFormat(sheetId, dataRows, 9, "DATE", "dd.mm.yyyy"));

    /* Контакт — текстом, и это не перестраховка. Телефон с ведущим плюсом
       Таблицы принимают за формулу, ячейка становится #ERROR!, и заявка
       теряется. Запись идёт с valueInputOption RAW, а текстовый формат не
       даёт таблице передумать позже — например, когда строку тронут руками. */
    requests.push(numberFormat(sheetId, dataRows, 2, "TEXT"));
    requests.push(numberFormat(sheetId, dataRows, 8, "NUMBER", "0"));

    const range = gridRange(sheetId, 1, 1 + dataRows, 0, columns);

    /* Порядок важен: правила добавляются по index: 0, то есть каждое
       следующее встаёт первым. Добавляем от менее важного к более важному,
       чтобы наверху оказалось «нет контакта» — оно и должно перекрывать
       остальные, потому что это брак, а не оттенок. */
    requests.push(conditionalRule(range, "=$I2>1", REPEAT_BG));
    /* NOW()-1, а не готовое число: формулу Google разбирает в локали самой
       таблицы, и дробное число с точкой в русской локали для неё невалидно
       (там разделитель — запятая), выгрузка падала целиком. Заодно порог
       перестаёт замерзать на момент выгрузки: между двумя запусками
       «за последние сутки» считается от текущего момента, а не от прошлого. */
    requests.push(conditionalRule(range, "=$J2>=NOW()-1", FRESH_BG));
    requests.push(conditionalRule(range, "=LEN($C2)=0", NO_CONTACT_BG, NO_CONTACT_FG));
  }

  requests.push(...commonRequests(sheetId, dataRows, columns, LEAD_WIDTHS));
  return requests;
}

/* Лист «События»: 7 колонок, A..G. A — дата и время, B — человек,
   G — детали. */
export function eventRequests(sheetId: number, dataRows: number, columns: number): unknown[] {
  const requests: unknown[] = [];

  if (dataRows > 0) {
    requests.push(numberFormat(sheetId, dataRows, 0, "DATE_TIME", "dd.mm.yyyy hh:mm"));

    /* Строки идут группами по человеку. Подсвечиваем ту, где человек
       сменился, — иначе тысячи строк подряд читаются одной простынёй.
       Для первой строки данных сравнение идёт с шапкой и тоже срабатывает,
       что и нужно: группа там начинается. */
    requests.push(
      conditionalRule(gridRange(sheetId, 1, 1 + dataRows, 0, columns), "=$B2<>$B1", PERSON_START_BG)
    );

    /* «Детали» переносим по строкам, а не пускаем за край ячейки: колонка
       последняя, справа от неё сетка кончается, и вылезший текст просто
       обрезался бы. Выравниваем по верху — иначе строка, ставшая двойной,
       разъезжается с соседними по вертикали. */
    requests.push({
      repeatCell: {
        range: gridRange(sheetId, 1, 1 + dataRows, columns - 1, columns),
        cell: { userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "TOP" } },
        fields: "userEnteredFormat(wrapStrategy,verticalAlignment)",
      },
    });
  }

  /* Последняя в EVENT_WIDTHS — «Детали»: по содержимому колонка растянулась
     бы на пол-экрана и утащила остальные за границу окна, поэтому ширина
     задана, а текст в ней переносится по строкам. */
  requests.push(...commonRequests(sheetId, dataRows, columns, EVENT_WIDTHS));
  return requests;
}
