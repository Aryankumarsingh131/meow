/**
 * T07: S02 Sources screen — search first, QR secondary, last known record.
 *
 * All decision logic lives in `./sourceCatalog.ts` and is tested by
 * tests/sources_client.test.ts. This file is JSX and wiring only, because it
 * cannot be executed here: Node has no JSX transform in strip-only mode and
 * no React test renderer is installed (installing one edits
 * apps/mobile/package.json and the mobile lockfile, which are T03's declared
 * files, role B). **This component has never been rendered or recorded** —
 * see docs/agent-workflow/handoff-T07.md.
 *
 * Layout follows ui-ux-specification.md S02: search first, QR secondary,
 * with edge states for empty assignment, stale timestamp, unknown QR,
 * permission denied and missing coordinates.
 *
 * There is deliberately no camera/scanner component wired in: `expo-camera`
 * is not installed and adding it is the same role-B lockfile change. The
 * screen accepts a scanned string through `onScan` so the host can supply it
 * once a scanner exists; the safety logic does not depend on which scanner.
 */

import React, { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import {
  buildHistorySlice,
  needsStalenessWarning,
  resolveScan,
  searchCache,
  type CachedSource,
  type HistoryRow,
  type ScanOutcome,
  // No file extension: the Expo/Metro tsconfig does not enable
  // `allowImportingTsExtensions`. The root tsconfig used for the Node test
  // harness does, which is why tests/sources_client.test.ts imports with
  // `.ts` while this file must not.
} from "./sourceCatalog";

export interface SourcesScreenProps {
  /** Locally cached, already tenant-scoped catalogue. The server filters by
   *  tenant; the cache only ever holds the signed-in tenant's rows. */
  cache: readonly CachedSource[];
  /** Last known history for the selected source, from network or cache. */
  history?: {
    sourceId: string;
    rows: readonly HistoryRow[];
    origin: "network" | "cache";
    servedAt: string | null;
  };
  onSelectSource(source: CachedSource): void;
  /** Non-null when the catalogue could not be loaded for this tenant. */
  permissionDenied?: boolean;
  now?: () => number;
}

export function SourcesScreen({
  cache,
  history,
  onSelectSource,
  permissionDenied = false,
  now = Date.now,
}: SourcesScreenProps): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [scan, setScan] = useState<ScanOutcome | null>(null);

  const results = useMemo(() => searchCache(cache, query), [cache, query]);

  const slice = useMemo(
    () =>
      history
        ? buildHistorySlice(history.sourceId, history.rows, history.origin, history.servedAt, now())
        : null,
    [history, now],
  );

  // A scan never navigates. It only ever selects a source already present in
  // the local catalogue, or shows a message. See sourceCatalog.parseScannedPayload.
  const handleScan = (payload: string | null) => {
    const outcome = resolveScan(payload, cache);
    setScan(outcome);
    if (outcome.kind === "matched") onSelectSource(outcome.source);
  };

  if (permissionDenied) {
    return (
      <View style={styles.container}>
        <Text style={styles.notice}>
          You do not have access to this source catalogue. Ask your supervisor to check your
          assignment.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        placeholder="Search by source or village"
        accessibilityLabel="Search sources"
        autoCorrect={false}
        maxLength={60}
      />

      {scan && scan.kind !== "matched" && (
        <Text style={styles.notice} accessibilityLiveRegion="polite">
          {scan.kind === "unknown"
            ? `Code ${scan.token} is not in your assigned list.`
            : "That code could not be read as a JalSakshi source code."}
        </Text>
      )}

      {cache.length === 0 ? (
        <Text style={styles.notice}>
          No sources are assigned to you yet. Ask your supervisor to assign one.
        </Text>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={<Text style={styles.notice}>No source matches that search.</Text>}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => onSelectSource(item)}
              accessibilityRole="button"
              accessibilityLabel={`${item.label}, ${item.locality}`}
            >
              <Text style={styles.label}>{item.label}</Text>
              <Text style={styles.locality}>{item.locality}</Text>
              {item.latitude === null && (
                // Missing coordinates never block identification.
                <Text style={styles.subtle}>No saved location</Text>
              )}
            </Pressable>
          )}
        />
      )}

      {slice && (
        <View style={styles.history}>
          {/* Always qualified. This is the last recorded screening, not a
              current status and not a laboratory result. */}
          <Text style={needsStalenessWarning(slice) ? styles.stale : styles.subtle}>
            {slice.label}
            {slice.origin === "cache" ? " (offline copy)" : ""}
          </Text>
          {slice.entries.length === 0 ? (
            <Text style={styles.subtle}>No recorded test for this source yet.</Text>
          ) : (
            slice.entries.map((entry) => (
              <View key={entry.sampleId} style={styles.historyRow}>
                <Text style={styles.subtle}>{entry.receivedAtServer}</Text>
                {/* Screening flag and method stay separate fields; neither is
                    a lab result and neither is a potability statement. */}
                <Text style={styles.subtle}>
                  Screening: {entry.indicativeFlag} ({entry.method})
                </Text>
              </View>
            ))
          )}
        </View>
      )}
    </View>
  );
}

/** Exposed so the host can feed a scanner result in once one exists. */
export type { ScanOutcome };

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  search: { borderWidth: 1, borderColor: "#888", borderRadius: 8, padding: 12, fontSize: 16 },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#eee" },
  label: { fontSize: 16, fontWeight: "600" },
  locality: { fontSize: 14, color: "#444" },
  subtle: { fontSize: 13, color: "#555" },
  stale: { fontSize: 13, color: "#8a5300", fontWeight: "600" },
  notice: { fontSize: 14, color: "#333", paddingVertical: 8 },
  history: { borderTopWidth: 1, borderTopColor: "#ddd", paddingTop: 12, gap: 4 },
  historyRow: { paddingVertical: 4 },
});
