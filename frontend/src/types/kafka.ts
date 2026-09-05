// ── Kafka topic browser (read-only) ──

export interface KafkaTopicInfo {
  name: string
  partitions: number
}

export interface KafkaTopicsResponse {
  topics: KafkaTopicInfo[]
}

export interface KafkaPartitionOffset {
  partition: number
  low: number
  high: number
}

export interface KafkaOffsetsResponse {
  topic: string
  partitions: KafkaPartitionOffset[]
}

export interface KafkaMessage {
  partition: number
  offset: number
  key: string
  value: string
  timestamp: string
}

export interface KafkaMessagesResponse {
  messages: KafkaMessage[]
}

export interface KafkaGroupPartition {
  topic: string
  partition: number
  committed_offset: number
  high_watermark: number
  lag: number
}

export interface KafkaGroupInfo {
  group_id: string
  protocol_type: string
  total_lag: number
  partitions: KafkaGroupPartition[]
}

export interface KafkaGroupsResponse {
  groups: KafkaGroupInfo[]
}
