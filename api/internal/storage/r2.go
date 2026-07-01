package storage

import (
	"bytes"
	"context"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// R2 stores objects in Cloudflare R2 via its S3-compatible API.
type R2 struct {
	client    *s3.Client
	bucket    string
	publicURL string
}

func NewR2(accountID, accessKeyID, secretAccessKey, bucket, publicURL string) *R2 {
	endpoint := fmt.Sprintf("https://%s.r2.cloudflarestorage.com", accountID)
	client := s3.New(s3.Options{
		Region:       "auto",
		BaseEndpoint: aws.String(endpoint),
		Credentials:  credentials.NewStaticCredentialsProvider(accessKeyID, secretAccessKey, ""),
	})
	return &R2{
		client:    client,
		bucket:    bucket,
		publicURL: strings.TrimSuffix(publicURL, "/"),
	}
}

func (s *R2) key(accountID, imageID, filename string) string {
	return fmt.Sprintf("%s/%s/%s", accountID, imageID, filename)
}

func (s *R2) Save(accountID, imageID, filename string, data []byte) error {
	_, err := s.client.PutObject(context.Background(), &s3.PutObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(s.key(accountID, imageID, filename)),
		Body:   bytes.NewReader(data),
	})
	if err != nil {
		return fmt.Errorf("r2: put object: %w", err)
	}
	return nil
}

func (s *R2) URL(accountID, imageID, filename string) string {
	return fmt.Sprintf("%s/%s", s.publicURL, s.key(accountID, imageID, filename))
}

func (s *R2) DeleteAll(accountID, imageID string) error {
	ctx := context.Background()
	prefix := fmt.Sprintf("%s/%s/", accountID, imageID)

	var keys []types.ObjectIdentifier
	var continuationToken *string
	for {
		out, err := s.client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
			Bucket:            aws.String(s.bucket),
			Prefix:            aws.String(prefix),
			ContinuationToken: continuationToken,
		})
		if err != nil {
			return fmt.Errorf("r2: list objects: %w", err)
		}
		for _, obj := range out.Contents {
			keys = append(keys, types.ObjectIdentifier{Key: obj.Key})
		}
		if !aws.ToBool(out.IsTruncated) {
			break
		}
		continuationToken = out.NextContinuationToken
	}

	if len(keys) == 0 {
		return nil
	}

	_, err := s.client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
		Bucket: aws.String(s.bucket),
		Delete: &types.Delete{Objects: keys},
	})
	if err != nil {
		return fmt.Errorf("r2: delete objects: %w", err)
	}
	return nil
}
