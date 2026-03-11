# Persona ZKP Artifacts

Versioned ACIR/VK artifacts used by the Persona ZKP engine.
The runtime still depends on an external Noir/Barretenberg runner for `prove`/`verify`.

## Runner Contract

Set `SOCIETY_PERSONA_ZKP_PROVIDER=noir-bb` and `SOCIETY_PERSONA_ZKP_RUNNER=/path/to/runner`.

The runner is invoked as:

- `runner prove` with JSON on stdin:
  `{ vaultId, circuitId, privateInputs, publicInputs, claimIds, issuedAt, expiresAt }`
- `runner verify` with JSON on stdin:
  `{ circuitId, proof, publicInputs, claimIds, expiresAt }`

The runner must emit JSON:

- prove: `{ proof, publicInputs?, claimIds? }`
- verify: `{ valid: boolean, reason?: string }`
