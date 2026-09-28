pipeline {
  agent { label 'docker-agent' }

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '10'))
    timeout(time: 45, unit: 'MINUTES')
  }

  environment {
    AWS_ACCOUNT_ID = '499133675204'
    AWS_REGION     = 'ap-south-1'
    ECR_REPO       = 'devops-portfolio'
    ECR_REGISTRY   = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
    S3_BUCKET      = 'ashmit-devops-artifacts-499133675204'
    EKS_CLUSTER    = 'prod-eks'
    K8S_NS         = 'production'
  }

  stages {
    stage('Checkout Git') {
      steps {
        checkout scm
        script {
          env.GIT_SHORT = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
          env.IMAGE_TAG = "${env.BUILD_NUMBER}-${env.GIT_SHORT}"
          env.IMAGE_URI = "${env.ECR_REGISTRY}/${env.ECR_REPO}:${env.IMAGE_TAG}"
        }
      }
    }

    stage('npm install') {
      steps { sh 'npm ci' }
    }

    stage('Lint + Type Check') {
      steps {
        sh 'npm run lint'
        sh 'npm run typecheck'
      }
    }

    stage('Unit Tests') {
      steps { sh 'npm test' }
    }

    stage('SonarQube / SAST') {
      steps {
        withCredentials([
          string(credentialsId: 'sonar-token', variable: 'SONAR_TOKEN'),
          string(credentialsId: 'sonar-host-url', variable: 'SONAR_HOST')
        ]) {
          sh 'sonar-scanner -Dsonar.host.url=$SONAR_HOST -Dsonar.token=$SONAR_TOKEN -Dsonar.qualitygate.wait=true'
        }
      }
    }

    stage('Dependency Scan') {
      steps { sh 'npm audit --omit=dev --audit-level=critical' }
    }

    stage('npm build') {
      steps { sh 'npm run build' }
    }

    stage('Package Artifact -> S3') {
      steps {
        sh '''
          tar -czf app-${IMAGE_TAG}.tar.gz dist package.json package-lock.json
          aws s3 cp app-${IMAGE_TAG}.tar.gz s3://${S3_BUCKET}/artifacts/${BRANCH_NAME}/app-${IMAGE_TAG}.tar.gz
        '''
      }
    }

    stage('Docker Build') {
      steps { sh 'docker build -t ${IMAGE_URI} .' }
    }

    stage('Trivy Image Scan') {
      steps {
        sh 'trivy image --exit-code 1 --severity CRITICAL --ignore-unfixed --no-progress ${IMAGE_URI}'
      }
    }

    stage('Push Image -> ECR') {
      when { branch 'main' }
      steps {
        sh '''
          aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_REGISTRY}
          docker push ${IMAGE_URI}
        '''
      }
    }

    stage('Approval') {
      when { branch 'main' }
      steps { input message: 'Deploy this build to PRODUCTION?', ok: 'Deploy' }
    }

    stage('Deploy to Kubernetes (production)') {
      when { branch 'main' }
      steps {
        withCredentials([string(credentialsId: 'db-password', variable: 'DB_PASSWORD')]) {
          sh '''
            aws eks update-kubeconfig --name ${EKS_CLUSTER} --region ${AWS_REGION}
            kubectl apply -f k8s/00-namespace.yaml
            kubectl apply -f k8s/01-configmap.yaml
            kubectl -n ${K8S_NS} create secret generic app-secret \
              --from-literal=DB_USER=appadmin \
              --from-literal=DB_PASSWORD="$DB_PASSWORD" \
              --dry-run=client -o yaml | kubectl apply -f -
            sed -i "s|IMAGE_PLACEHOLDER|${IMAGE_URI}|" k8s/02-deployment.yaml
            kubectl apply -f k8s/02-deployment.yaml
            kubectl apply -f k8s/03-service.yaml
            kubectl apply -f k8s/04-ingress.yaml
            kubectl apply -f k8s/05-hpa.yaml
            kubectl -n ${K8S_NS} rollout status deployment/devops-portfolio --timeout=180s || {
              echo "Rollout failed, rolling back"
              kubectl -n ${K8S_NS} rollout undo deployment/devops-portfolio
              exit 1
            }
            kubectl -n ${K8S_NS} get deploy,pods,svc,ingress,hpa
          '''
        }
      }
    }
  }

  post {
    always { sh 'docker image prune -f || true'; deleteDir() }
    success { echo "Build ${env.IMAGE_TAG} succeeded" }
    failure { echo "Build ${env.IMAGE_TAG} FAILED" }
  }
}
