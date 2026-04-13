// ============================================================
// InfraEye — CI Pipeline (Continuous Integration Only)
// Runs on every push / PR. Does NOT deploy or push images.
//
// NOTE: Per-stage docker agents removed for compatibility with
// Jenkins instances that lack the Docker Pipeline plugin.
// Go and Node must be available on the Jenkins agent, OR
// install the "Docker Pipeline" plugin and restore docker{} blocks.
// ============================================================
pipeline {
    agent any

    // ── Environment ──────────────────────────────────────────
    environment {
        IMAGE_NAME   = "infra-eye"
        GIT_SHA      = sh(script: "git rev-parse --short HEAD", returnStdout: true).trim()
        IMAGE_TAG    = "${env.BRANCH_NAME}-${GIT_SHA}"

        // Go settings
        GOPATH       = "${WORKSPACE}/.gopath"
        GOMODCACHE   = "${WORKSPACE}/.gopath/pkg/mod"
        GO_VERSION   = "1.22"

        // Node settings
        NODE_VERSION = "20"
    }

    options {
        buildDiscarder(logRotator(numToKeepStr: '10'))
        timeout(time: 30, unit: 'MINUTES')
        disableConcurrentBuilds()
        timestamps()
    }

    stages {
        // ── Stage 1: Checkout ─────────────────────────────────
        stage('Checkout') {
            steps {
                checkout scm
                sh 'git log --oneline -5'
            }
        }

        // ── Stage 2: Backend CI ───────────────────────────────
        stage('Backend: Download Deps') {
            steps {
                dir('backend') {
                    sh 'go mod download'
                    sh 'go mod verify'
                }
            }
        }

        stage('Backend: Vet') {
            steps {
                dir('backend') {
                    sh 'go vet ./...'
                }
            }
        }

        stage('Backend: Test') {
            steps {
                dir('backend') {
                    sh '''
                        go test -v -race -count=1 \
                            -coverprofile=coverage.out \
                            ./... 2>&1 | tee test-results.txt
                    '''
                }
            }
            post {
                always {
                    dir('backend') {
                        archiveArtifacts artifacts: 'coverage.out', allowEmptyArchive: true
                    }
                }
            }
        }

        stage('Backend: Build Check') {
            steps {
                dir('backend') {
                    sh '''
                        CGO_ENABLED=0 GOOS=linux \
                        go build -ldflags="-s -w" \
                        -o /tmp/server-check \
                        ./cmd/server/main.go
                    '''
                    echo '✅ Backend binary compiled successfully'
                }
            }
        }

        // ── Stage 3: Frontend CI ──────────────────────────────
        stage('Frontend: Install') {
            steps {
                dir('frontend') {
                    sh 'npm ci --prefer-offline'
                }
            }
        }

        stage('Frontend: Type Check') {
            steps {
                dir('frontend') {
                    sh 'npx tsc -b --noEmit'
                }
            }
        }

        stage('Frontend: Build') {
            steps {
                dir('frontend') {
                    sh 'npm run build'
                    echo '✅ Frontend bundle compiled successfully'
                }
            }
            post {
                success {
                    archiveArtifacts artifacts: 'frontend/dist/**', allowEmptyArchive: false
                }
            }
        }

        // ── Stage 4: Docker Image Build Validation ────────────
        stage('Docker: Build Validation') {
            steps {
                sh '''
                    docker build \
                        --no-cache \
                        --label "git.commit=${GIT_SHA}" \
                        --label "git.branch=${BRANCH_NAME}" \
                        --label "build.number=${BUILD_NUMBER}" \
                        -t ${IMAGE_NAME}:ci-${IMAGE_TAG} \
                        -f Dockerfile \
                        .
                '''
                echo "✅ Docker image ${IMAGE_NAME}:ci-${IMAGE_TAG} built successfully"
            }
            post {
                always {
                    sh "docker rmi ${IMAGE_NAME}:ci-${IMAGE_TAG} || true"
                }
            }
        }
    }

    // ── Post Actions ──────────────────────────────────────────
    post {
        success {
            echo """
╔══════════════════════════════════════════╗
║  ✅  CI PASSED — ${IMAGE_NAME}:${IMAGE_TAG}
║  Branch : ${env.BRANCH_NAME}
║  Commit : ${GIT_SHA}
║  Build  : #${env.BUILD_NUMBER}
╚══════════════════════════════════════════╝
"""
        }
        failure {
            echo """
╔══════════════════════════════════════════╗
║  ❌  CI FAILED — ${IMAGE_NAME}:${IMAGE_TAG}
║  Branch : ${env.BRANCH_NAME}
║  Commit : ${GIT_SHA}
║  Build  : #${env.BUILD_NUMBER}
╚══════════════════════════════════════════╝
"""
        }
        always {
            cleanWs()
        }
    }
}
