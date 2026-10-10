import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Правила сервера",
  description: "Правила Minecraft-сервера Loki Ti и условия проходки.",
  alternates: { canonical: "/rules" },
};

const sections = [
  {
    title: "Общие правила",
    items: [
      "Уважай других игроков и администрацию. Оскорбления, травля и провокации — блокировка.",
      "Запрещены читы, макросы, дюпы, багоюз и любой софт, дающий преимущество.",
      "Запрещена реклама, капс в чате и спам.",
      "Обход блокировки (другой ник, другой аккаунт) приравнивается к повторному нарушению.",
    ],
  },
  {
    title: "Проходка и доступ",
    items: [
      "Проходка даёт доступ на whitelist до конца текущего сезона (вайпа).",
      "Один Telegram-аккаунт — один Minecraft-ник. Смена ника только через заявку в боте.",
      "После вайпа доступ не переносится автоматически: проходку нужно продлить.",
      "Передача, продажа и shared-доступ к проходке запрещены.",
    ],
  },
  {
    title: "Строительство и мир",
    items: [
      "Не строй ближе 150 блоков к чужим постройкам без согласия владельца.",
      "Гриф, воровство и уничтожение чужого имущества запрещены.",
      "Порталы, фермы и механизмы, ломающие сервер, удаляются администрацией.",
    ],
  },
  {
    title: "Ответственность",
    items: [
      "Администрация вправе выдать мут, бан или снять проходку за нарушение правил.",
      "Решения модераторов обжалуются через тикет /support в боте.",
      "Возврат средств возможен только по правилам, описанным на странице возврата.",
    ],
  },
];

export default function RulesPage() {
  return (
    <div className="container max-w-4xl py-14">
      <span className="chip">Документы</span>
      <h1 className="mt-5 font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
        Правила сервера Loki Ti
      </h1>
      <p className="mt-4 text-body">
        Играя на сервере, ты подтверждаешь, что прочитал правила и согласен с ними.
        Последнее обновление: {new Date().toLocaleDateString("ru-RU")}.
      </p>

      <div className="mt-10 space-y-5">
        {sections.map((s, i) => (
          <section key={s.title} className="glass p-6 sm:p-7">
            <h2 className="flex items-baseline gap-3 font-display text-lg font-semibold text-ink">
              <span className="font-mono text-xs font-semibold text-magic">
                {String(i + 1).padStart(2, "0")}
              </span>
              {s.title}
            </h2>
            <ul className="mt-4 space-y-3">
              {s.items.map((item) => (
                <li
                  key={item}
                  className="flex gap-3 text-sm leading-relaxed text-body"
                >
                  <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-magic" />
                  {item}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link href="/refund" className="btn-ghost px-5 py-3 text-sm">
          Условия возврата средств
        </Link>
        <Link href="/buy" className="btn-primary px-5 py-3 text-sm">
          Купить проходку
        </Link>
      </div>
    </div>
  );
}
