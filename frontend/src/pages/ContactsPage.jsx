import { LegalLayout } from '../components/LegalLayout.jsx';
import { COMPANY } from '../legal/company.js';
import { SupportEmailLink } from '../legal/SupportEmail.jsx';

export default function ContactsPage() {
  const telHref = `tel:${COMPANY.phone.replace(/[^\d+]/g, '')}`;

  return (
    <LegalLayout
      title="Контакты"
      lead={`Свяжитесь с нами по вопросам подписки, оплаты и работы сервиса ${COMPANY.productName}.`}
    >
      <div className="site-contact-grid">
        <div className="site-contact-card">
          <h3>Email</h3>
          <SupportEmailLink />
        </div>

        <div className="site-contact-card">
          <h3>Телефон</h3>
          <a href={telHref}>{COMPANY.phone}</a>
        </div>

        <div className="site-contact-card span-2">
          <h3>Реквизиты</h3>
          <dl className="site-contact-meta">
            <div>
              <dt>Форма</dt>
              <dd>{COMPANY.form}</dd>
            </div>
            <div>
              <dt>ФИО</dt>
              <dd>{COMPANY.legalName}</dd>
            </div>
            <div>
              <dt>ИНН</dt>
              <dd>{COMPANY.inn}</dd>
            </div>
            <div>
              <dt>Адрес</dt>
              <dd>{COMPANY.address}</dd>
            </div>
          </dl>
        </div>
      </div>

      <p className="site-note">
        Эти реквизиты используются в оферте, политике ПДн и при модерации платежей ЮKassa.
      </p>
    </LegalLayout>
  );
}
