---
skill:
  id: rare-disease-consult
  name: Rare Disease Consultation
  version: "1.0.0"
  description: Request specialist consultation for rare disease cases via RarasNet hospital agents
  author: rarasnet
  tags:
    - medical
    - rare-disease
    - consultation

runtime:
  type: http
  http:
    endpoint: http://localhost:18801/chat
    method: POST
    timeout: 60

triggers:
  - type: manual
    config:
      description: Manual rare disease consultation request

capabilities:
  inputs:
    - name: message
      type: string
      description: The case presentation or consultation question
      required: true
  outputs:
    - name: response
      type: string
      description: Specialist consultation response

actions:
  - name: consult
    description: Send consultation request to hospital agent
    type: http
    config:
      endpoint: http://localhost:18801/chat

society:
  room: rarasnet-consultations
  federation: rarasnet
  requireConsensus: false

security:
  sandbox: light
  permissions:
    - network:http
  maxExecutionTime: 60000
  allowNetwork: true
---
# Rare Disease Consultation Skill

Sends a case presentation to a specialist hospital agent in the RarasNet federation
and returns the consultation response. Uses the HTTP runtime to communicate with
nanobot-powered hospital containers.
