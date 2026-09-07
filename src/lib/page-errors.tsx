import { ConfigError } from "@/db";
import { SetupNotice } from "@/components/setup-notice";
import { isConnectionError, isMissingSchemaError } from "@/lib/db-errors";

/**
 * Turns an infrastructure failure into a page that says what to do about it.
 *
 * Returns null for anything that is not a recognisable deployment problem, so
 * genuine bugs still reach the error boundary and are still reported as bugs
 * rather than being papered over with a friendly setup screen.
 */
export function setupNoticeFor(error: unknown): React.ReactElement | null {
  if (error instanceof ConfigError) {
    return (
      <SetupNotice
        title="Configuration du serveur incomplète"
        message="L'application est déployée mais il lui manque un réglage pour démarrer."
        detail={`${error.message}\n\n${error.hint}`}
      />
    );
  }

  if (isMissingSchemaError(error)) {
    return (
      <SetupNotice
        title="Base de données non initialisée"
        message="La connexion fonctionne, mais les tables n'ont pas encore été créées. Ces deux commandes, lancées une seule fois avec DATABASE_URL pointant sur la base de production, terminent l'installation."
        steps={["npm run db:migrate", "npm run db:seed"]}
      />
    );
  }

  if (isConnectionError(error)) {
    return (
      <SetupNotice
        title="Base de données injoignable"
        message="Le serveur n'arrive pas à joindre la base. Vérifiez que DATABASE_URL est correct et que la base est active, puis rechargez cette page."
      />
    );
  }

  return null;
}
