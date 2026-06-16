{{/* Chart name, overridable. */}}
{{- define "buncus.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Fully qualified app name. */}}
{{- define "buncus.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "buncus.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "buncus.labels" -}}
helm.sh/chart: {{ include "buncus.chart" . }}
{{ include "buncus.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "buncus.selectorLabels" -}}
app.kubernetes.io/name: {{ include "buncus.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "buncus.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "buncus.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* Resolved image reference: digest wins over tag; tag falls back to appVersion. */}}
{{- define "buncus.image" -}}
{{- if .Values.image.digest -}}
{{- printf "%s@%s" .Values.image.repository .Values.image.digest -}}
{{- else -}}
{{- printf "%s:%s" .Values.image.repository (.Values.image.tag | default .Chart.AppVersion) -}}
{{- end -}}
{{- end -}}

{{/* Effective BUNCUS_DB path: the mounted file when persisting, else config.db. */}}
{{- define "buncus.dbPath" -}}
{{- if .Values.persistence.enabled -}}
{{- .Values.persistence.path -}}
{{- else -}}
{{- .Values.config.db -}}
{{- end -}}
{{- end -}}

{{/* Name of the Secret to load env from (existing or chart-created). */}}
{{- define "buncus.secretName" -}}
{{- default (include "buncus.fullname" .) .Values.secrets.existingSecret -}}
{{- end -}}

{{/* "true" when the chart should render its own Secret from inline values. */}}
{{- define "buncus.createSecret" -}}
{{- if .Values.secrets.existingSecret -}}
false
{{- else if or .Values.secrets.githubAppId .Values.secrets.githubClientId .Values.secrets.githubClientSecret .Values.secrets.githubPrivateKey .Values.secrets.encryptionPassword .Values.secrets.githubWebhookSecret -}}
true
{{- else -}}
false
{{- end -}}
{{- end -}}

{{/* "true" when an env-bearing Secret exists to mount (existing or created). */}}
{{- define "buncus.hasSecret" -}}
{{- if or .Values.secrets.existingSecret (eq (include "buncus.createSecret" .) "true") -}}
true
{{- else -}}
false
{{- end -}}
{{- end -}}

{{/* Non-secret env vars. Blanks are omitted so buncus' own defaults apply. */}}
{{- define "buncus.env" -}}
- name: PORT
  value: {{ .Values.config.port | quote }}
- name: BUNCUS_DB
  value: {{ include "buncus.dbPath" . | quote }}
{{- with .Values.config.publicUrl }}
- name: BUNCUS_PUBLIC_URL
  value: {{ . | quote }}
{{- end }}
{{- with .Values.config.apiHost }}
- name: GITHUB_API_HOST
  value: {{ . | quote }}
{{- end }}
{{- with .Values.config.oauthHost }}
- name: GITHUB_OAUTH_HOST
  value: {{ . | quote }}
{{- end }}
{{- with .Values.config.sessionTtlDays }}
- name: SESSION_TTL_DAYS
  value: {{ . | quote }}
{{- end }}
{{- if .Values.config.mock }}
- name: BUNCUS_MOCK
  value: "1"
{{- end }}
{{- if .Values.config.origins }}
- name: ORIGINS
  value: {{ .Values.config.origins | toJson | quote }}
{{- end }}
{{- if .Values.config.originsRegex }}
- name: ORIGINS_REGEX
  value: {{ .Values.config.originsRegex | toJson | quote }}
{{- end }}
{{- if .Values.config.themeOrigins }}
- name: THEME_ORIGINS
  value: {{ .Values.config.themeOrigins | toJson | quote }}
{{- end }}
{{- end -}}
