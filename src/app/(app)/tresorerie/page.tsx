          <h3>Suivi et confirmation des crédits</h3>
          {internalTransfersError
            ? <p className="muted" role="status">Le registre des transferts ne peut pas être consulté pour le moment.</p>
            : !internalTransfers.length
              ? <EmptyState title="Aucun transfert suivi" description="Le premier transfert réel enregistré apparaîtra ici."/>
              : <div className="tableWrap"><table><thead><tr><th>Date / référence</th><th>Trajet</th><th>Débit source</th><th>Frais</th><th>Crédit attendu</th><th>État / confirmation</th></tr></thead><tbody>