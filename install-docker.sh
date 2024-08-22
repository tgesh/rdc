#!/bin/bash
apt-get update -y
apt-get install -y docker.io
systemctl start docker
usermod -aG docker ubuntu
systemctl enable docker