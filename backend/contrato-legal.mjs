// Texto del contrato de arrendamiento de maquinaria según la legislación
// salvadoreña. Es una plantilla de apoyo: debe ser revisada por un abogado
// antes de usarse como documento legal definitivo.

export const SEGUROS = {
  TODO_RIESGO: 'Seguro todo riesgo contratado por el arrendador, con deducible a cargo del arrendatario',
  RESPONSABILIDAD_CIVIL: 'Seguro de responsabilidad civil contratado por el arrendador',
  POR_CUENTA_DEL_CLIENTE: 'Póliza contratada por el arrendatario, que debe entregar copia vigente antes de la entrega del equipo',
};

export const FORMAS_PAGO = {
  EFECTIVO: 'en efectivo',
  TRANSFERENCIA: 'por transferencia bancaria',
  CHEQUE: 'con cheque',
  CREDITO_30_DIAS: 'a crédito, dentro de los treinta (30) días siguientes a la facturación',
};

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];

function longDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return `${day} de ${MONTHS[month - 1]} de ${year}`;
}

function usd(value) {
  return `US$ ${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function buildContractDocument(contract) {
  const equipos = contract.maquinarias
    .map((m) => `${m.maquinaria_nombre} (${usd(m.tarifa_diaria)} por día)`).join('; ');
  const operador = contract.operador
    ? `${contract.operador}${contract.operador_documento ? `, con DUI número ${contract.operador_documento}` : ''}`
    : 'por designar';
  const seguro = SEGUROS[contract.seguro] || 'No especificado';
  const pago = FORMAS_PAGO[contract.forma_pago] || 'según lo acordado por las partes';
  const clausulas = [
    ['PRIMERA: OBJETO',
      `El ARRENDADOR, Constructora El Salvador, concede al ARRENDATARIO, ${contract.cliente}, el goce temporal de la maquinaria siguiente: ${equipos}. El arrendamiento se rige por las disposiciones del Código Civil de la República de El Salvador sobre el arrendamiento de cosas y, en lo aplicable, por el Código de Comercio.`],
    ['SEGUNDA: PLAZO',
      `El plazo es de ${contract.dias} ${contract.dias === 1 ? 'día' : 'días'} calendario, contado desde el ${longDate(contract.fecha_inicio)} hasta el ${longDate(contract.fecha_fin)}, ambos días inclusive. Cualquier prórroga requiere acuerdo escrito y está sujeta a la disponibilidad del equipo.`],
    ['TERCERA: LUGAR DE USO',
      `El equipo se utilizará exclusivamente en la obra ubicada en ${contract.ciudad}, El Salvador. No podrá trasladarse a otro lugar sin autorización escrita del ARRENDADOR.`],
    ['CUARTA: PRECIO Y FORMA DE PAGO',
      `La tarifa diaria total es de ${usd(contract.tarifa_diaria)} y el total del arrendamiento es de ${usd(contract.total)}. El pago se hará ${pago}. Sobre estos montos se aplicará el Impuesto a la Transferencia de Bienes Muebles y a la Prestación de Servicios (IVA) conforme a la ley. El retraso en el pago genera intereses moratorios conforme a la legislación vigente.`],
    ['QUINTA: OPERADOR',
      `El equipo será operado por ${operador}, designado por el ARRENDADOR. La relación laboral del operador es exclusivamente con el ARRENDADOR; el ARRENDATARIO se obliga a darle condiciones seguras de trabajo y a no asignarle labores distintas a las propias del equipo.`],
    ['SEXTA: SEGURO',
      `Cobertura: ${seguro}. El seguro no cubre daños por uso indebido, negligencia, operación por personas no autorizadas ni uso fuera del lugar y plazo pactados, los cuales serán asumidos por el ARRENDATARIO.`],
    ['SÉPTIMA: ENTREGA Y DEVOLUCIÓN',
      'El equipo se entrega en buen estado de funcionamiento, lo que se hará constar en acta de entrega. El ARRENDATARIO lo devolverá en el mismo estado, salvo el desgaste natural por el uso, en la fecha de fin del plazo. El retraso en la devolución genera el cobro de la tarifa diaria por cada día adicional.'],
    ['OCTAVA: OBLIGACIONES DEL ARRENDATARIO',
      'Usar el equipo conforme a su naturaleza y manual del fabricante, no subarrendarlo ni cederlo, cuidarlo con la diligencia de un buen padre de familia, y responder por pérdida, robo o daños no cubiertos por el seguro.'],
    ['NOVENA: OBLIGACIONES DEL ARRENDADOR',
      'Entregar el equipo en condiciones de uso, proporcionar el operador designado, dar mantenimiento ordinario y reemplazar el equipo o descontar el tiempo perdido cuando la falla no se deba al ARRENDATARIO.'],
    ['DÉCIMA: TERMINACIÓN',
      'Son causas de terminación anticipada, sin perjuicio de la indemnización de daños y perjuicios: la falta de pago, el uso distinto al pactado, el subarriendo o la cesión sin autorización y el incumplimiento grave de cualquier cláusula. En tal caso el ARRENDADOR podrá retirar el equipo de inmediato.'],
    ['UNDÉCIMA: CASO FORTUITO O FUERZA MAYOR',
      'Ninguna de las partes responde por incumplimientos causados por caso fortuito o fuerza mayor debidamente acreditados, como fenómenos naturales o actos de autoridad. La parte afectada deberá notificarlo a la otra a la mayor brevedad.'],
    ['DUODÉCIMA: DATOS PERSONALES Y DEFENSA DEL CONSUMIDOR',
      'Los datos personales de las partes se usarán solo para la ejecución de este contrato, conforme a la normativa aplicable en materia de protección de datos personales. Este contrato respeta los derechos reconocidos al consumidor por la Ley de Protección al Consumidor.'],
    ['DECIMOTERCERA: CONDICIONES ESPECIALES',
      contract.condiciones_especiales || 'Las partes no pactan condiciones especiales adicionales.'],
    ['DECIMOCUARTA: JURISDICCIÓN',
      'Para cualquier controversia, las partes se someten a los tribunales competentes de la ciudad de San Salvador y señalan como domicilio especial el de dicha ciudad.'],
  ].map(([titulo, texto]) => ({ titulo, texto }));
  return {
    titulo: 'CONTRATO DE ARRENDAMIENTO DE MAQUINARIA',
    numero: contract.id,
    clausulas,
    aviso: 'Plantilla de apoyo. Debe ser revisada por un profesional del derecho antes de su firma.',
  };
}
