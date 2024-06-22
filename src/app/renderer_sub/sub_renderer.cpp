#include "sub_renderer.hpp"

#include <assert.h>
#include <array>

namespace NugieApp {
    SubRenderer::Builder::Builder(NugieVulkan::Device *device, uint32_t width, uint32_t height, uint32_t imageCount,
                                  uint32_t layerNum)
                                  : device{device}, width{width}, height{height}, imageCount{imageCount}, layerNum{layerNum} {
        this->outputAttachmentRefs.emplace_back();
        this->depthAttachmentRefs.emplace_back();
        this->inputAttachmentRefs.emplace_back();
        this->resolveAttachmentRefs.emplace_back();
        this->attachmentInfos.emplace_back();
    }

    SubRenderer::Builder &
    SubRenderer::Builder::addAttachment(AttachmentType attachmentType, VkFormat format, VkImageLayout layout,
                                        VkSampleCountFlagBits sample) 
    {
        SubRendererAttachmentDesc attachDesc{};
        attachDesc.attachmentRole = AttachmentRole::COLOR;
        attachDesc.subpassIndex = static_cast<uint32_t>(this->depthAttachmentRefs.size() - 1u);
        attachDesc.attachmentType = attachmentType;
        attachDesc.format = format;
        attachDesc.sample = sample;
        attachDesc.isOutside = false;

        this->subRendererAttachmentDescs.emplace_back(attachDesc);

        VkImageUsageFlags imageUsage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT;
        if (attachmentType == AttachmentType::INPUT_OUTPUT) {
            imageUsage |= VK_IMAGE_USAGE_INPUT_ATTACHMENT_BIT;
        } else if (attachmentType == AttachmentType::OUTPUT_TEXTURE) {
            imageUsage |= VK_IMAGE_USAGE_SAMPLED_BIT;
        } else if (attachmentType == AttachmentType::OUTPUT_SHADER) {
            imageUsage |= VK_IMAGE_USAGE_STORAGE_BIT;
        }

        std::vector<NugieVulkan::Image *> frameImages{};
        for (size_t i = 0; i < this->imageCount; i++) {
            frameImages.emplace_back(new NugieVulkan::Image(this->device, this->width, this->height, 1, sample, format,
                                                            VK_IMAGE_TILING_OPTIMAL, imageUsage, VMA_MEMORY_USAGE_AUTO,
                                                            VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT,
                                                            VK_IMAGE_ASPECT_COLOR_BIT));
        }

        this->attachments.emplace_back(frameImages);
        this->createdAttachments.emplace_back(frameImages);

        VkAttachmentStoreOp storeOp =
                attachmentType != AttachmentType::KEEPED && attachmentType != AttachmentType::INPUT_OUTPUT
                ? VK_ATTACHMENT_STORE_OP_STORE
                : VK_ATTACHMENT_STORE_OP_DONT_CARE;

        VkAttachmentDescription attachmentDesc{};
        attachmentDesc.format = format;
        attachmentDesc.samples = sample;
        attachmentDesc.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
        attachmentDesc.storeOp = storeOp;
        attachmentDesc.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
        attachmentDesc.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
        attachmentDesc.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        attachmentDesc.finalLayout = layout;

        this->attachmentDescs.emplace_back(attachmentDesc);

        VkAttachmentReference attachmentRef{};
        attachmentRef.attachment = static_cast<uint32_t>(this->attachments.size() - 1);
        attachmentRef.layout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;

        this->outputAttachmentRefs[this->outputAttachmentRefs.size() - 1].emplace_back(attachmentRef);

        if (attachmentType == AttachmentType::INPUT_OUTPUT) {
            VkAttachmentReference attachmentRef{};
            attachmentRef.attachment = static_cast<uint32_t>(this->attachments.size() - 1);
            attachmentRef.layout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

            this->inputAttachmentRefs[this->inputAttachmentRefs.size() - 1].emplace_back(attachmentRef);

            std::vector<VkDescriptorImageInfo> imageInfos{};
            imageInfos.reserve(frameImages.size());

            for (auto &&frameImage: frameImages) {
                imageInfos.emplace_back(frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
            }

            this->attachmentInfos[this->attachmentInfos.size() - 1].emplace_back(imageInfos);
        } else if (attachmentType == AttachmentType::OUTPUT_SHADER) {
            std::vector<VkDescriptorImageInfo> imageInfos{};
            imageInfos.reserve(frameImages.size());

            for (auto &&frameImage: frameImages) {
                imageInfos.emplace_back(frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_GENERAL));
            }

            this->attachmentInfos[this->attachmentInfos.size() - 1].emplace_back(imageInfos);
        } else if (attachmentType == AttachmentType::OUTPUT_TEXTURE) {
            std::vector<NugieVulkan::Sampler *> samplers{};
            samplers.reserve(frameImages.size());

            for (auto &&frameImage: frameImages) {
                samplers.emplace_back(new NugieVulkan::Sampler(this->device, frameImage, VK_FILTER_NEAREST,
                                                               VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_BORDER, VK_FALSE,
                                                               VK_BORDER_COLOR_FLOAT_OPAQUE_BLACK, VK_COMPARE_OP_NEVER,
                                                               VK_SAMPLER_MIPMAP_MODE_NEAREST));
            }

            this->attachmentSamplers.emplace_back(samplers);

            std::vector<VkDescriptorImageInfo> imageInfos{};
            imageInfos.reserve(samplers.size());

            for (auto &&sampler: samplers) {
                imageInfos.emplace_back(sampler->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
            }

            this->attachmentInfos[this->attachmentInfos.size() - 1].emplace_back(imageInfos);
        }

        return *this;
    }

    SubRenderer::Builder &SubRenderer::Builder::addAttachment(const std::vector<NugieVulkan::Image *> &frameImages,
                                                              AttachmentType attachmentType, VkFormat format,
                                                              VkImageLayout layout,
                                                              VkSampleCountFlagBits sample) 
    {
        SubRendererAttachmentDesc attachDesc{};
        attachDesc.attachmentRole = AttachmentRole::COLOR;
        attachDesc.subpassIndex = static_cast<uint32_t>(this->depthAttachmentRefs.size() - 1u);
        attachDesc.attachmentType = attachmentType;
        attachDesc.isOutside = true;

        this->subRendererAttachmentDescs.emplace_back(attachDesc);
        this->attachments.emplace_back(frameImages);

        VkAttachmentStoreOp storeOp =
                attachmentType != AttachmentType::KEEPED && attachmentType != AttachmentType::INPUT_OUTPUT
                ? VK_ATTACHMENT_STORE_OP_STORE
                : VK_ATTACHMENT_STORE_OP_DONT_CARE;

        VkAttachmentDescription attachmentDesc{};
        attachmentDesc.format = format;
        attachmentDesc.samples = sample;
        attachmentDesc.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
        attachmentDesc.storeOp = storeOp;
        attachmentDesc.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
        attachmentDesc.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
        attachmentDesc.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        attachmentDesc.finalLayout = layout;

        this->attachmentDescs.emplace_back(attachmentDesc);

        VkAttachmentReference attachmentRef{};
        attachmentRef.attachment = static_cast<uint32_t>(this->attachments.size() - 1);
        attachmentRef.layout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;

        this->outputAttachmentRefs[this->outputAttachmentRefs.size() - 1].emplace_back(attachmentRef);

        if (attachmentType == AttachmentType::INPUT_OUTPUT) {
            VkAttachmentReference attachmentRef{};
            attachmentRef.attachment = static_cast<uint32_t>(this->attachments.size() - 1);
            attachmentRef.layout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

            this->inputAttachmentRefs[this->inputAttachmentRefs.size() - 1].emplace_back(attachmentRef);

            std::vector<VkDescriptorImageInfo> imageInfos{};
            imageInfos.reserve(frameImages.size());

            for (auto &&frameImage: frameImages) {
                imageInfos.emplace_back(frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
            }

            this->attachmentInfos[this->attachmentInfos.size() - 1].emplace_back(imageInfos);
        } else if (attachmentType == AttachmentType::OUTPUT_SHADER) {
            std::vector<VkDescriptorImageInfo> imageInfos{};
            imageInfos.reserve(frameImages.size());

            for (auto &&frameImage: frameImages) {
                imageInfos.emplace_back(frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_GENERAL));
            }

            this->attachmentInfos[this->attachmentInfos.size() - 1].emplace_back(imageInfos);
        } else if (attachmentType == AttachmentType::OUTPUT_TEXTURE) {
            std::vector<NugieVulkan::Sampler *> samplers{};
            samplers.reserve(frameImages.size());

            for (auto &&frameImage: frameImages) {
                samplers.emplace_back(new NugieVulkan::Sampler(this->device, frameImage, VK_FILTER_NEAREST,
                                                               VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_BORDER, VK_FALSE,
                                                               VK_BORDER_COLOR_FLOAT_OPAQUE_BLACK, VK_COMPARE_OP_NEVER,
                                                               VK_SAMPLER_MIPMAP_MODE_NEAREST));
            }

            this->attachmentSamplers.emplace_back(samplers);

            std::vector<VkDescriptorImageInfo> imageInfos{};
            imageInfos.reserve(samplers.size());

            for (auto &&sampler: samplers) {
                imageInfos.emplace_back(sampler->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
            }

            this->attachmentInfos[this->attachmentInfos.size() - 1].emplace_back(imageInfos);
        }

        return *this;
    }

    SubRenderer::Builder &SubRenderer::Builder::setDepthAttachment(AttachmentType attachmentType,
                                                                   VkFormat format, VkImageLayout layout,
                                                                   VkSampleCountFlagBits sample) 
    {
        SubRendererAttachmentDesc attachDesc{};
        attachDesc.attachmentRole = AttachmentRole::DEPTH;
        attachDesc.subpassIndex = static_cast<uint32_t>(this->depthAttachmentRefs.size() - 1u);
        attachDesc.attachmentType = attachmentType;
        attachDesc.format = format;
        attachDesc.sample = sample;
        attachDesc.isOutside = false;

        this->subRendererAttachmentDescs.emplace_back(attachDesc);

        VkImageUsageFlags imageUsage = VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT;
        if (attachmentType == AttachmentType::INPUT_OUTPUT) {
            imageUsage |= VK_IMAGE_USAGE_INPUT_ATTACHMENT_BIT;
        } else if (attachmentType == AttachmentType::OUTPUT_TEXTURE) {
            imageUsage |= VK_IMAGE_USAGE_SAMPLED_BIT;
        } else if (attachmentType == AttachmentType::OUTPUT_SHADER) {
            imageUsage |= VK_IMAGE_USAGE_STORAGE_BIT;
        }

        std::vector<NugieVulkan::Image *> frameImages{};
        for (size_t i = 0; i < this->imageCount; i++) {
            frameImages.emplace_back(new NugieVulkan::Image(this->device, this->width, this->height, 1, sample, format,
                                                            VK_IMAGE_TILING_OPTIMAL, imageUsage, VMA_MEMORY_USAGE_AUTO,
                                                            VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT,
                                                            VK_IMAGE_ASPECT_DEPTH_BIT));
        }

        this->attachments.emplace_back(frameImages);
        this->createdAttachments.emplace_back(frameImages);

        VkAttachmentStoreOp storeOp =
                attachmentType != AttachmentType::KEEPED && attachmentType != AttachmentType::INPUT_OUTPUT
                ? VK_ATTACHMENT_STORE_OP_STORE
                : VK_ATTACHMENT_STORE_OP_DONT_CARE;

        VkAttachmentDescription attachmentDesc{};
        attachmentDesc.format = format;
        attachmentDesc.samples = sample;
        attachmentDesc.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
        attachmentDesc.storeOp = storeOp;
        attachmentDesc.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
        attachmentDesc.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
        attachmentDesc.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        attachmentDesc.finalLayout = layout;

        this->attachmentDescs.emplace_back(attachmentDesc);

        VkAttachmentReference attachmentRef{};
        attachmentRef.attachment = static_cast<uint32_t>(this->attachments.size() - 1);
        attachmentRef.layout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;

        this->depthAttachmentRefs[this->depthAttachmentRefs.size() - 1] = attachmentRef;

        if (attachmentType == AttachmentType::INPUT_OUTPUT) {
            VkAttachmentReference attachmentRef{};
            attachmentRef.attachment = static_cast<uint32_t>(this->attachments.size() - 1);
            attachmentRef.layout = VK_IMAGE_LAYOUT_DEPTH_READ_ONLY_OPTIMAL;

            this->inputAttachmentRefs[this->inputAttachmentRefs.size() - 1].emplace_back(attachmentRef);

            std::vector<VkDescriptorImageInfo> imageInfos{};
            imageInfos.reserve(frameImages.size());

            for (auto &&frameImage: frameImages) {
                imageInfos.emplace_back(frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_DEPTH_READ_ONLY_OPTIMAL));
            }

            this->attachmentInfos[this->attachmentInfos.size() - 1].emplace_back(imageInfos);
        } else if (attachmentType == AttachmentType::OUTPUT_SHADER) {
            std::vector<VkDescriptorImageInfo> imageInfos{};
            imageInfos.reserve(frameImages.size());

            for (auto &&frameImage: frameImages) {
                imageInfos.emplace_back(frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_GENERAL));
            }

            this->attachmentInfos[this->attachmentInfos.size() - 1].emplace_back(imageInfos);
        } else if (attachmentType == AttachmentType::OUTPUT_TEXTURE) {
            std::vector<NugieVulkan::Sampler *> samplers{};
            samplers.reserve(frameImages.size());

            for (auto &&frameImage: frameImages) {
                samplers.emplace_back(new NugieVulkan::Sampler(this->device, frameImage, VK_FILTER_LINEAR,
                                                               VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_BORDER, VK_FALSE,
                                                               VK_BORDER_COLOR_FLOAT_OPAQUE_WHITE, VK_COMPARE_OP_LESS,
                                                               VK_SAMPLER_MIPMAP_MODE_NEAREST));
            }

            this->attachmentSamplers.emplace_back(samplers);

            std::vector<VkDescriptorImageInfo> imageInfos{};
            imageInfos.reserve(samplers.size());

            for (auto &&sampler: samplers) {
                imageInfos.emplace_back(sampler->getDescriptorInfo(VK_IMAGE_LAYOUT_DEPTH_READ_ONLY_OPTIMAL));
            }

            this->attachmentInfos[this->attachmentInfos.size() - 1].emplace_back(imageInfos);
        }

        return *this;
    }

    SubRenderer::Builder &SubRenderer::Builder::setDepthAttachment(const std::vector<NugieVulkan::Image *> &frameImages,
                                                                   AttachmentType attachmentType, VkFormat format,
                                                                   VkImageLayout layout, VkSampleCountFlagBits sample) 
    {
        SubRendererAttachmentDesc attachDesc{};
        attachDesc.attachmentRole = AttachmentRole::DEPTH;
        attachDesc.subpassIndex = static_cast<uint32_t>(this->depthAttachmentRefs.size() - 1u);
        attachDesc.attachmentType = attachmentType;
        attachDesc.isOutside = true;

        this->subRendererAttachmentDescs.emplace_back(attachDesc);
        this->attachments.emplace_back(frameImages);

        VkAttachmentStoreOp storeOp =
                attachmentType != AttachmentType::KEEPED && attachmentType != AttachmentType::INPUT_OUTPUT
                ? VK_ATTACHMENT_STORE_OP_STORE
                : VK_ATTACHMENT_STORE_OP_DONT_CARE;

        VkAttachmentDescription attachmentDesc{};
        attachmentDesc.format = format;
        attachmentDesc.samples = sample;
        attachmentDesc.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
        attachmentDesc.storeOp = storeOp;
        attachmentDesc.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
        attachmentDesc.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
        attachmentDesc.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        attachmentDesc.finalLayout = layout;

        this->attachmentDescs.emplace_back(attachmentDesc);

        VkAttachmentReference attachmentRef{};
        attachmentRef.attachment = static_cast<uint32_t>(this->attachments.size() - 1);
        attachmentRef.layout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;

        this->depthAttachmentRefs[this->depthAttachmentRefs.size() - 1] = attachmentRef;

        if (attachmentType == AttachmentType::INPUT_OUTPUT) {
            VkAttachmentReference attachmentRef{};
            attachmentRef.attachment = static_cast<uint32_t>(this->attachments.size() - 1);
            attachmentRef.layout = VK_IMAGE_LAYOUT_DEPTH_READ_ONLY_OPTIMAL;

            this->inputAttachmentRefs[this->inputAttachmentRefs.size() - 1].emplace_back(attachmentRef);

            std::vector<VkDescriptorImageInfo> imageInfos{};
            imageInfos.reserve(frameImages.size());

            for (auto &&frameImage: frameImages) {
                imageInfos.emplace_back(frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_DEPTH_READ_ONLY_OPTIMAL));
            }

            this->attachmentInfos[this->attachmentInfos.size() - 1].emplace_back(imageInfos);
        } else if (attachmentType == AttachmentType::OUTPUT_SHADER) {
            std::vector<VkDescriptorImageInfo> imageInfos{};
            imageInfos.reserve(frameImages.size());

            for (auto &&frameImage: frameImages) {
                imageInfos.emplace_back(frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_GENERAL));
            }

            this->attachmentInfos[this->attachmentInfos.size() - 1].emplace_back(imageInfos);
        } else if (attachmentType == AttachmentType::OUTPUT_TEXTURE) {
            std::vector<NugieVulkan::Sampler *> samplers{};
            samplers.reserve(frameImages.size());

            for (auto &&frameImage: frameImages) {
                samplers.emplace_back(new NugieVulkan::Sampler(this->device, frameImage, VK_FILTER_LINEAR,
                                                               VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_BORDER, VK_FALSE,
                                                               VK_BORDER_COLOR_FLOAT_OPAQUE_WHITE, VK_COMPARE_OP_LESS,
                                                               VK_SAMPLER_MIPMAP_MODE_NEAREST));
            }

            this->attachmentSamplers.emplace_back(samplers);

            std::vector<VkDescriptorImageInfo> imageInfos{};
            imageInfos.reserve(samplers.size());

            for (auto &&sampler: samplers) {
                imageInfos.emplace_back(sampler->getDescriptorInfo(VK_IMAGE_LAYOUT_DEPTH_READ_ONLY_OPTIMAL));
            }

            this->attachmentInfos[this->attachmentInfos.size() - 1].emplace_back(imageInfos);
        }

        return *this;
    }

    SubRenderer::Builder &
    SubRenderer::Builder::addResolvedAttachment(AttachmentType attachmentType, VkFormat format, VkImageLayout layout) {
        SubRendererAttachmentDesc attachDesc{};
        attachDesc.attachmentRole = AttachmentRole::RESOLVED;
        attachDesc.subpassIndex = static_cast<uint32_t>(this->depthAttachmentRefs.size() - 1u);
        attachDesc.attachmentType = attachmentType;
        attachDesc.format = format;
        attachDesc.sample = VK_SAMPLE_COUNT_1_BIT;
        attachDesc.isOutside = false;

        this->subRendererAttachmentDescs.emplace_back(attachDesc);

        VkImageUsageFlags imageUsage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT;
        if (attachmentType == AttachmentType::INPUT_OUTPUT) {
            imageUsage |= VK_IMAGE_USAGE_INPUT_ATTACHMENT_BIT;
        } else if (attachmentType == AttachmentType::OUTPUT_TEXTURE) {
            imageUsage |= VK_IMAGE_USAGE_SAMPLED_BIT;
        } else if (attachmentType == AttachmentType::OUTPUT_SHADER) {
            imageUsage |= VK_IMAGE_USAGE_STORAGE_BIT;
        }

        std::vector<NugieVulkan::Image *> frameImages{};
        for (size_t i = 0; i < this->imageCount; i++) {
            frameImages.emplace_back(
                    new NugieVulkan::Image(this->device, this->width, this->height, 1, VK_SAMPLE_COUNT_1_BIT, format,
                                           VK_IMAGE_TILING_OPTIMAL, imageUsage, VMA_MEMORY_USAGE_AUTO,
                                           VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT,
                                           VK_IMAGE_ASPECT_COLOR_BIT));
        }

        this->attachments.emplace_back(frameImages);
        this->createdAttachments.emplace_back(frameImages);

        VkAttachmentStoreOp storeOp =
                attachmentType != AttachmentType::KEEPED && attachmentType != AttachmentType::INPUT_OUTPUT
                ? VK_ATTACHMENT_STORE_OP_STORE
                : VK_ATTACHMENT_STORE_OP_DONT_CARE;

        VkAttachmentDescription attachmentDesc{};
        attachmentDesc.format = format;
        attachmentDesc.samples = VK_SAMPLE_COUNT_1_BIT;
        attachmentDesc.loadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
        attachmentDesc.storeOp = storeOp;
        attachmentDesc.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
        attachmentDesc.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
        attachmentDesc.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        attachmentDesc.finalLayout = layout;

        this->attachmentDescs.emplace_back(attachmentDesc);

        VkAttachmentReference attachmentRef{};
        attachmentRef.attachment = static_cast<uint32_t>(this->attachments.size() - 1);
        attachmentRef.layout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;

        this->resolveAttachmentRefs[this->resolveAttachmentRefs.size() - 1].emplace_back(attachmentRef);

        if (attachmentType == AttachmentType::INPUT_OUTPUT) {
            VkAttachmentReference attachmentRef{};
            attachmentRef.attachment = static_cast<uint32_t>(this->attachments.size() - 1);
            attachmentRef.layout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

            this->inputAttachmentRefs[this->inputAttachmentRefs.size() - 1].emplace_back(attachmentRef);

            std::vector<VkDescriptorImageInfo> imageInfos{};
            imageInfos.reserve(frameImages.size());

            for (auto &&frameImage: frameImages) {
                imageInfos.emplace_back(frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
            }

            this->attachmentInfos[this->attachmentInfos.size() - 1].emplace_back(imageInfos);
        } else if (attachmentType == AttachmentType::OUTPUT_SHADER) {
            std::vector<VkDescriptorImageInfo> imageInfos{};
            imageInfos.reserve(frameImages.size());

            for (auto &&frameImage: frameImages) {
                imageInfos.emplace_back(frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_GENERAL));
            }

            this->attachmentInfos[this->attachmentInfos.size() - 1].emplace_back(imageInfos);
        } else if (attachmentType == AttachmentType::OUTPUT_TEXTURE) {
            std::vector<NugieVulkan::Sampler *> samplers{};
            samplers.reserve(frameImages.size());

            for (auto &&frameImage: frameImages) {
                samplers.emplace_back(new NugieVulkan::Sampler(this->device, frameImage, VK_FILTER_NEAREST,
                                                               VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_BORDER, VK_FALSE,
                                                               VK_BORDER_COLOR_FLOAT_OPAQUE_BLACK, VK_COMPARE_OP_NEVER,
                                                               VK_SAMPLER_MIPMAP_MODE_NEAREST));
            }

            this->attachmentSamplers.emplace_back(samplers);

            std::vector<VkDescriptorImageInfo> imageInfos{};
            imageInfos.reserve(samplers.size());

            for (auto &&sampler: samplers) {
                imageInfos.emplace_back(sampler->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
            }

            this->attachmentInfos[this->attachmentInfos.size() - 1].emplace_back(imageInfos);
        }

        return *this;
    }

    SubRenderer::Builder &
    SubRenderer::Builder::addResolvedAttachment(const std::vector<NugieVulkan::Image *> &frameImages,
                                                AttachmentType attachmentType,
                                                VkFormat format, VkImageLayout layout) 
    {
        SubRendererAttachmentDesc attachDesc{};
        attachDesc.attachmentRole = AttachmentRole::RESOLVED;
        attachDesc.subpassIndex = static_cast<uint32_t>(this->depthAttachmentRefs.size() - 1u);
        attachDesc.attachmentType = attachmentType;
        attachDesc.isOutside = true;

        this->subRendererAttachmentDescs.emplace_back(attachDesc);
        this->attachments.emplace_back(frameImages);

        VkAttachmentStoreOp storeOp =
                attachmentType != AttachmentType::KEEPED && attachmentType != AttachmentType::INPUT_OUTPUT
                ? VK_ATTACHMENT_STORE_OP_STORE
                : VK_ATTACHMENT_STORE_OP_DONT_CARE;

        VkAttachmentDescription attachmentDesc{};
        attachmentDesc.format = format;
        attachmentDesc.samples = VK_SAMPLE_COUNT_1_BIT;
        attachmentDesc.loadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
        attachmentDesc.storeOp = storeOp;
        attachmentDesc.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
        attachmentDesc.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
        attachmentDesc.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        attachmentDesc.finalLayout = layout;

        this->attachmentDescs.emplace_back(attachmentDesc);

        VkAttachmentReference attachmentRef{};
        attachmentRef.attachment = static_cast<uint32_t>(this->attachments.size() - 1);
        attachmentRef.layout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;

        this->resolveAttachmentRefs[this->resolveAttachmentRefs.size() - 1].emplace_back(attachmentRef);

        if (attachmentType == AttachmentType::INPUT_OUTPUT) {
            VkAttachmentReference attachmentRef{};
            attachmentRef.attachment = static_cast<uint32_t>(this->attachments.size() - 1);
            attachmentRef.layout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

            this->inputAttachmentRefs[this->inputAttachmentRefs.size() - 1].emplace_back(attachmentRef);

            std::vector<VkDescriptorImageInfo> imageInfos{};
            imageInfos.reserve(frameImages.size());

            for (auto &&frameImage: frameImages) {
                imageInfos.emplace_back(frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
            }

            this->attachmentInfos[this->attachmentInfos.size() - 1].emplace_back(imageInfos);
        } else if (attachmentType == AttachmentType::OUTPUT_SHADER) {
            std::vector<VkDescriptorImageInfo> imageInfos{};
            imageInfos.reserve(frameImages.size());

            for (auto &&frameImage: frameImages) {
                imageInfos.emplace_back(frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_GENERAL));
            }

            this->attachmentInfos[this->attachmentInfos.size() - 1].emplace_back(imageInfos);
        } else if (attachmentType == AttachmentType::OUTPUT_TEXTURE) {
            std::vector<NugieVulkan::Sampler *> samplers{};
            samplers.reserve(frameImages.size());

            for (auto &&frameImage: frameImages) {
                samplers.emplace_back(new NugieVulkan::Sampler(this->device, frameImage, VK_FILTER_NEAREST,
                                                               VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_BORDER, VK_FALSE,
                                                               VK_BORDER_COLOR_FLOAT_OPAQUE_BLACK, VK_COMPARE_OP_NEVER,
                                                               VK_SAMPLER_MIPMAP_MODE_NEAREST));
            }

            this->attachmentSamplers.emplace_back(samplers);

            std::vector<VkDescriptorImageInfo> imageInfos{};
            imageInfos.reserve(samplers.size());

            for (auto &&sampler: samplers) {
                imageInfos.emplace_back(sampler->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
            }

            this->attachmentInfos[this->attachmentInfos.size() - 1].emplace_back(imageInfos);
        }

        return *this;
    }

    SubRenderer::Builder &SubRenderer::Builder::nextSubpass() {
        this->outputAttachmentRefs.emplace_back();
        this->depthAttachmentRefs.emplace_back();
        this->inputAttachmentRefs.emplace_back();
        this->resolveAttachmentRefs.emplace_back();
        this->attachmentInfos.emplace_back();

        return *this;
    }

    SubRenderer *SubRenderer::Builder::build() {
        std::vector<std::vector<NugieVulkan::Image *>> attachments = this->attachments;

        return new SubRenderer(this->device, this->width, this->height, this->layerNum, this->attachments,
                               this->createdAttachments,
                               this->attachmentDescs, this->outputAttachmentRefs, this->depthAttachmentRefs,
                               this->inputAttachmentRefs,
                               this->resolveAttachmentRefs, this->attachmentSamplers, this->subRendererAttachmentDescs,
                               this->attachmentInfos);
    }

    SubRenderer::Overwriter::Overwriter(NugieVulkan::Device *device, uint32_t width, uint32_t height,
                                        uint32_t imageCount, uint32_t layerNum)
            : device{device}, width{width}, height{height}, imageCount{imageCount}, layerNum{layerNum} {

    }

    SubRenderer::Overwriter &
    SubRenderer::Overwriter::addOutsideAttachment(const std::vector<NugieVulkan::Image *> &attachments) {
        this->outsideAttachments.emplace_back(attachments);
        return *this;
    }

    void SubRenderer::Overwriter::overwrite(SubRenderer *subRenderer) {
        subRenderer->recreateResources(this->width, this->height, this->imageCount, this->outsideAttachments);
    }

    SubRenderer::SubRenderer(NugieVulkan::Device *device, uint32_t width, uint32_t height, uint32_t layerNum,
                             const std::vector<std::vector<NugieVulkan::Image *>> &attachments,
                             const std::vector<std::vector<NugieVulkan::Image *>> &createdAttachments,
                             const std::vector<VkAttachmentDescription> &attachmentDescs,
                             const std::vector<std::vector<VkAttachmentReference>> &outputAttachmentRefs,
                             const std::vector<VkAttachmentReference> &depthAttachmentRefs,
                             const std::vector<std::vector<VkAttachmentReference>> &inputAttachmentRefs,
                             const std::vector<std::vector<VkAttachmentReference>> &resolveAttachmentRefs,
                             const std::vector<std::vector<NugieVulkan::Sampler *>> &attachmentSamplers,
                             const std::vector<SubRendererAttachmentDesc> &subRendererAttachmentDescs,
                             const std::vector<std::vector<std::vector<VkDescriptorImageInfo>>> &attachmentInfos)
                             : device{device}, width{width}, height{height}, layerNum{layerNum}, createdAttachments{createdAttachments},
                               attachmentSamplers{attachmentSamplers}, subRendererAttachmentDescs{subRendererAttachmentDescs},
                               attachmentInfos{attachmentInfos} 
    {
        this->createRenderPass(attachments, attachmentDescs, outputAttachmentRefs, depthAttachmentRefs,
                               inputAttachmentRefs, resolveAttachmentRefs);
    }

    SubRenderer::~SubRenderer() {
        if (this->renderPass != nullptr) delete this->renderPass;

        for (auto &&attachmentSampler: attachmentSamplers) {
            for (auto &&sampler: attachmentSampler) {
                if (sampler != nullptr) delete sampler;
            }
        }

        for (auto &&createdAttachment: this->createdAttachments) {
            for (auto &&attachment: createdAttachment) {
                if (attachment != nullptr) delete attachment;
            }
        }
    }

    void SubRenderer::createRenderPass(const std::vector<std::vector<NugieVulkan::Image *>> &attachments,
                                       const std::vector<VkAttachmentDescription> &attachmentDescs,
                                       const std::vector<std::vector<VkAttachmentReference>> &outputAttachmentRefs,
                                       const std::vector<VkAttachmentReference> &depthAttachmentRefs,
                                       const std::vector<std::vector<VkAttachmentReference>> &inputAttachmentRefs,
                                       const std::vector<std::vector<VkAttachmentReference>> &resolveAttachmentRefs) 
    {
        std::vector<VkSubpassDescription> subpasses;
        std::vector<VkSubpassDependency> subpassDependencies;

        this->clearValues.clear();
        for (size_t i = 0; i < depthAttachmentRefs.size(); i++) {
            VkSubpassDescription subpass{};

            subpass.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;

            subpass.colorAttachmentCount = static_cast<uint32_t>(outputAttachmentRefs[i].size());
            subpass.pColorAttachments = !outputAttachmentRefs[i].empty() ? outputAttachmentRefs[i].data() : nullptr;
            subpass.pDepthStencilAttachment = &depthAttachmentRefs[i];
            subpass.pResolveAttachments =
                    !resolveAttachmentRefs[i].empty() ? resolveAttachmentRefs[i].data() : nullptr;

            if (i > 0) {
                subpass.inputAttachmentCount = static_cast<uint32_t>(inputAttachmentRefs[i - 1].size());
                subpass.pInputAttachments =
                        !inputAttachmentRefs[i - 1].empty() ? inputAttachmentRefs[i - 1].data() : nullptr;
            }

            subpasses.emplace_back(subpass);

            for (auto &&outputAttachmentRef: outputAttachmentRefs[i]) {
                VkClearValue clearValue;
                clearValue.color = {0.0f, 0.0f, 0.0f, 1.0f};

                this->clearValues.emplace_back(clearValue);
            }

            VkClearValue clearValue;
            clearValue.depthStencil = {1.0f, 0};

            this->clearValues.emplace_back(clearValue);
        }

        auto renderPassBuilder = NugieVulkan::RenderPass::Builder(this->device, this->width, this->height,
                                                                  this->layerNum);
        for (const auto & subpass : subpasses) {
            renderPassBuilder.addSubpass(subpass);
        }

        for (const auto & attachmentDesc : attachmentDescs) {
            renderPassBuilder.addAttachment(attachmentDesc);
        }

        for (size_t i = 0; i < attachments[0].size(); i++) {
            std::vector<VkImageView> imageViews;
            imageViews.reserve(attachments.size());

            for (const auto & attachment : attachments) {
                imageViews.emplace_back(attachment[i]->getImageView());
            }

            renderPassBuilder.addViewImages(imageViews);
        }

        for (uint32_t i = 0; i < static_cast<uint32_t>(subpasses.size() - 1); i++) {
            VkSubpassDependency dependency{};
            dependency.srcSubpass = i;
            dependency.srcAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
            dependency.srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
            dependency.dstSubpass = i + 1;
            dependency.dstStageMask = VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT;
            dependency.dstAccessMask = VK_ACCESS_INPUT_ATTACHMENT_READ_BIT;
            dependency.dependencyFlags = VK_DEPENDENCY_BY_REGION_BIT;

            renderPassBuilder.addDependency(dependency);
        }

        if (!outputAttachmentRefs.empty()) {
            VkSubpassDependency postColorDependency{};
            postColorDependency.srcSubpass = static_cast<uint32_t>(subpasses.size() - 1);
            postColorDependency.srcAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
            postColorDependency.srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
            postColorDependency.dstSubpass = VK_SUBPASS_EXTERNAL;
            postColorDependency.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
            postColorDependency.dstStageMask = VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT;
            postColorDependency.dependencyFlags = VK_DEPENDENCY_BY_REGION_BIT;

            renderPassBuilder.addDependency(postColorDependency);
        }

        if (!depthAttachmentRefs.empty()) {
            VkSubpassDependency postDepthDependency{};
            postDepthDependency.srcSubpass = static_cast<uint32_t>(subpasses.size() - 1);
            postDepthDependency.srcAccessMask = VK_ACCESS_DEPTH_STENCIL_ATTACHMENT_WRITE_BIT;
            postDepthDependency.srcStageMask = VK_PIPELINE_STAGE_LATE_FRAGMENT_TESTS_BIT;
            postDepthDependency.dstSubpass = VK_SUBPASS_EXTERNAL;
            postDepthDependency.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
            postDepthDependency.dstStageMask = VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT;
            postDepthDependency.dependencyFlags = VK_DEPENDENCY_BY_REGION_BIT;

            renderPassBuilder.addDependency(postDepthDependency);
        }

        this->renderPass = renderPassBuilder.build();
    }

    void SubRenderer::beginRenderPass(NugieVulkan::CommandBuffer *commandBuffer, uint32_t imageIndex) {
        VkRenderPassBeginInfo renderBeginInfo{};
        renderBeginInfo.sType = VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO;
        renderBeginInfo.renderPass = this->getRenderPass()->getRenderPass();
        renderBeginInfo.framebuffer = this->getRenderPass()->getFramebuffers(imageIndex);

        renderBeginInfo.renderArea.offset = {0, 0};
        renderBeginInfo.renderArea.extent = {static_cast<uint32_t>(this->width), static_cast<uint32_t>(this->height)};
        renderBeginInfo.clearValueCount = static_cast<uint32_t>(this->clearValues.size());
        renderBeginInfo.pClearValues = this->clearValues.data();

        vkCmdBeginRenderPass(commandBuffer->getCommandBuffer(), &renderBeginInfo, VK_SUBPASS_CONTENTS_INLINE);

        VkViewport viewport{};
        viewport.x = 0.0f;
        viewport.y = 0.0f;
        viewport.width = static_cast<float>(this->width);
        viewport.height = static_cast<float>(this->height);
        viewport.minDepth = 0.0f;
        viewport.maxDepth = 1.0f;

        VkRect2D scissor{{0,                                  0},
                         {static_cast<uint32_t>(this->width), static_cast<uint32_t>(this->height)}};

        vkCmdSetViewport(commandBuffer->getCommandBuffer(), 0, 1, &viewport);
        vkCmdSetScissor(commandBuffer->getCommandBuffer(), 0, 1, &scissor);
    }

    void SubRenderer::nextSubpass(NugieVulkan::CommandBuffer *commandBuffer, VkSubpassContents subPassContent) {
        vkCmdNextSubpass(commandBuffer->getCommandBuffer(), subPassContent);
    }

    void SubRenderer::endRenderPass(NugieVulkan::CommandBuffer *commandBuffer) {
        vkCmdEndRenderPass(commandBuffer->getCommandBuffer());
    }

    void SubRenderer::deleteCreatedAttachments() {
        for (auto &&attachmentSampler: this->attachmentSamplers) {
            for (auto &&sampler: attachmentSampler) {
                delete sampler;
            }
        }

        for (auto &&createdAttachment: this->createdAttachments) {
            for (auto &&attachment: createdAttachment) {
                delete attachment;
            }
        }
    }

    void SubRenderer::recreateResources(uint32_t width, uint32_t height, uint32_t imageCount,
                                        const std::vector<std::vector<NugieVulkan::Image *>> &outsideAttachments) 
    {
        this->width = width;
        this->height = height;

        uint32_t samplerIndex = 0u;

        for (auto &&createdAttachment: this->createdAttachments) {
            for (auto &&attachment: createdAttachment) {
                delete attachment;
            }

            createdAttachment.clear();
        }

        for (auto &&attachmentInfo: this->attachmentInfos) {
            attachmentInfo.clear();
        }

        this->createdAttachments.clear();
        this->attachmentInfos.clear();

        std::vector<std::vector<NugieVulkan::Image *>> attachments;
        uint32_t curOutsideAttachIndex = 0u;

        for (auto &&subRendererAttachmentDesc: this->subRendererAttachmentDescs) {
            if (subRendererAttachmentDesc.attachmentRole == AttachmentRole::COLOR) {
                std::vector<NugieVulkan::Image *> frameImages{};

                if (!subRendererAttachmentDesc.isOutside) {
                    VkImageUsageFlags imageUsage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT;
                    if (subRendererAttachmentDesc.attachmentType == AttachmentType::INPUT_OUTPUT) {
                        imageUsage |= VK_IMAGE_USAGE_INPUT_ATTACHMENT_BIT;
                    } else if (subRendererAttachmentDesc.attachmentType == AttachmentType::OUTPUT_TEXTURE) {
                        imageUsage |= VK_IMAGE_USAGE_SAMPLED_BIT;
                    } else if (subRendererAttachmentDesc.attachmentType == AttachmentType::OUTPUT_SHADER) {
                        imageUsage |= VK_IMAGE_USAGE_STORAGE_BIT;
                    }

                    for (size_t i = 0; i < imageCount; i++) {
                        frameImages.emplace_back(new NugieVulkan::Image(this->device, this->width, this->height, 1,
                                                                        subRendererAttachmentDesc.sample,
                                                                        subRendererAttachmentDesc.format,
                                                                        VK_IMAGE_TILING_OPTIMAL, imageUsage,
                                                                        VMA_MEMORY_USAGE_AUTO,
                                                                        VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT,
                                                                        VK_IMAGE_ASPECT_COLOR_BIT));
                    }

                    this->createdAttachments.emplace_back(frameImages);
                } else {
                    frameImages = outsideAttachments[curOutsideAttachIndex++];
                }

                attachments.emplace_back(frameImages);

                if (subRendererAttachmentDesc.attachmentType == AttachmentType::INPUT_OUTPUT) {
                    if (this->attachmentInfos.size() < subRendererAttachmentDesc.subpassIndex + 1) {
                        this->attachmentInfos.resize(subRendererAttachmentDesc.subpassIndex + 1);
                    }

                    std::vector<VkDescriptorImageInfo> imageInfos{};
                    imageInfos.reserve(frameImages.size());

                    for (auto &&frameImage: frameImages) {
                        imageInfos.emplace_back(
                                frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
                    }

                    this->attachmentInfos[subRendererAttachmentDesc.subpassIndex].emplace_back(imageInfos);
                } else if (subRendererAttachmentDesc.attachmentType == AttachmentType::OUTPUT_SHADER) {
                    if (this->attachmentInfos.size() < subRendererAttachmentDesc.subpassIndex + 1) {
                        this->attachmentInfos.resize(subRendererAttachmentDesc.subpassIndex + 1);
                    }

                    std::vector<VkDescriptorImageInfo> imageInfos{};
                    imageInfos.reserve(frameImages.size());

                    for (auto &&frameImage: frameImages) {
                        imageInfos.emplace_back(frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_GENERAL));
                    }

                    this->attachmentInfos[subRendererAttachmentDesc.subpassIndex].emplace_back(imageInfos);
                } else if (subRendererAttachmentDesc.attachmentType == AttachmentType::OUTPUT_TEXTURE) {
                    for (size_t i = 0; i < this->attachmentSamplers[samplerIndex].size(); i++) {
                        this->attachmentSamplers[samplerIndex][i]->setImage(frameImages[i]);
                    }

                    if (this->attachmentInfos.size() < subRendererAttachmentDesc.subpassIndex + 1) {
                        this->attachmentInfos.resize(subRendererAttachmentDesc.subpassIndex + 1);
                    }

                    std::vector<VkDescriptorImageInfo> imageInfos{};
                    for (auto &&sampler: this->attachmentSamplers[samplerIndex]) {
                        imageInfos.emplace_back(sampler->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
                    }

                    this->attachmentInfos[subRendererAttachmentDesc.subpassIndex].emplace_back(imageInfos);
                    samplerIndex++;
                }
            } else if (subRendererAttachmentDesc.attachmentRole == AttachmentRole::DEPTH) {
                std::vector<NugieVulkan::Image *> frameImages{};

                if (!subRendererAttachmentDesc.isOutside) {
                    VkImageUsageFlags imageUsage = VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT;
                    if (subRendererAttachmentDesc.attachmentType == AttachmentType::INPUT_OUTPUT) {
                        imageUsage |= VK_IMAGE_USAGE_INPUT_ATTACHMENT_BIT;
                    } else if (subRendererAttachmentDesc.attachmentType == AttachmentType::OUTPUT_TEXTURE) {
                        imageUsage |= VK_IMAGE_USAGE_SAMPLED_BIT;
                    } else if (subRendererAttachmentDesc.attachmentType == AttachmentType::OUTPUT_SHADER) {
                        imageUsage |= VK_IMAGE_USAGE_STORAGE_BIT;
                    }

                    for (size_t i = 0; i < imageCount; i++) {
                        frameImages.emplace_back(new NugieVulkan::Image(this->device, this->width, this->height, 1,
                                                                        subRendererAttachmentDesc.sample,
                                                                        subRendererAttachmentDesc.format,
                                                                        VK_IMAGE_TILING_OPTIMAL, imageUsage,
                                                                        VMA_MEMORY_USAGE_AUTO,
                                                                        VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT,
                                                                        VK_IMAGE_ASPECT_DEPTH_BIT));
                    }

                    attachments.emplace_back(frameImages);
                    this->createdAttachments.emplace_back(frameImages);
                } else {
                    frameImages = outsideAttachments[curOutsideAttachIndex++];
                }

                if (subRendererAttachmentDesc.attachmentType == AttachmentType::INPUT_OUTPUT) {
                    if (this->attachmentInfos.size() < subRendererAttachmentDesc.subpassIndex + 1) {
                        this->attachmentInfos.resize(subRendererAttachmentDesc.subpassIndex + 1);
                    }

                    std::vector<VkDescriptorImageInfo> imageInfos{};
                    imageInfos.reserve(frameImages.size());

                    for (auto &&frameImage: frameImages) {
                        imageInfos.emplace_back(frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_DEPTH_READ_ONLY_OPTIMAL));
                    }

                    this->attachmentInfos[subRendererAttachmentDesc.subpassIndex].emplace_back(imageInfos);
                } else if (subRendererAttachmentDesc.attachmentType == AttachmentType::OUTPUT_SHADER) {
                    if (this->attachmentInfos.size() < subRendererAttachmentDesc.subpassIndex + 1) {
                        this->attachmentInfos.resize(subRendererAttachmentDesc.subpassIndex + 1);
                    }

                    std::vector<VkDescriptorImageInfo> imageInfos{};
                    imageInfos.reserve(frameImages.size());

                    for (auto &&frameImage: frameImages) {
                        imageInfos.emplace_back(frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_GENERAL));
                    }

                    this->attachmentInfos[subRendererAttachmentDesc.subpassIndex].emplace_back(imageInfos);
                } else if (subRendererAttachmentDesc.attachmentType == AttachmentType::OUTPUT_TEXTURE) {
                    for (size_t i = 0; i < this->attachmentSamplers[samplerIndex].size(); i++) {
                        this->attachmentSamplers[samplerIndex][i]->setImage(frameImages[i]);
                    }

                    if (this->attachmentInfos.size() < subRendererAttachmentDesc.subpassIndex + 1) {
                        this->attachmentInfos.resize(subRendererAttachmentDesc.subpassIndex + 1);
                    }

                    std::vector<VkDescriptorImageInfo> imageInfos{};
                    for (auto &&sampler: this->attachmentSamplers[samplerIndex]) {
                        imageInfos.emplace_back(sampler->getDescriptorInfo(VK_IMAGE_LAYOUT_DEPTH_READ_ONLY_OPTIMAL));
                    }

                    this->attachmentInfos[subRendererAttachmentDesc.subpassIndex].emplace_back(imageInfos);
                    samplerIndex++;
                }
            } else if (subRendererAttachmentDesc.attachmentRole == AttachmentRole::RESOLVED) {
                std::vector<NugieVulkan::Image *> frameImages{};

                if (!subRendererAttachmentDesc.isOutside) {
                    VkImageUsageFlags imageUsage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT;
                    if (subRendererAttachmentDesc.attachmentType == AttachmentType::INPUT_OUTPUT) {
                        imageUsage |= VK_IMAGE_USAGE_INPUT_ATTACHMENT_BIT;
                    } else if (subRendererAttachmentDesc.attachmentType == AttachmentType::OUTPUT_TEXTURE) {
                        imageUsage |= VK_IMAGE_USAGE_SAMPLED_BIT;
                    } else if (subRendererAttachmentDesc.attachmentType == AttachmentType::OUTPUT_SHADER) {
                        imageUsage |= VK_IMAGE_USAGE_STORAGE_BIT;
                    }

                    for (size_t i = 0; i < imageCount; i++) {
                        frameImages.emplace_back(new NugieVulkan::Image(this->device, this->width, this->height, 1,
                                                                        subRendererAttachmentDesc.sample,
                                                                        subRendererAttachmentDesc.format,
                                                                        VK_IMAGE_TILING_OPTIMAL, imageUsage,
                                                                        VMA_MEMORY_USAGE_AUTO,
                                                                        VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT,
                                                                        VK_IMAGE_ASPECT_COLOR_BIT));
                    }

                    this->createdAttachments.emplace_back(frameImages);
                } else {
                    frameImages = outsideAttachments[curOutsideAttachIndex++];
                }

                attachments.emplace_back(frameImages);

                if (subRendererAttachmentDesc.attachmentType == AttachmentType::INPUT_OUTPUT) {
                    if (this->attachmentInfos.size() < subRendererAttachmentDesc.subpassIndex + 1) {
                        this->attachmentInfos.resize(subRendererAttachmentDesc.subpassIndex + 1);
                    }

                    std::vector<VkDescriptorImageInfo> imageInfos{};
                    imageInfos.reserve(frameImages.size());

                    for (auto &&frameImage: frameImages) {
                        imageInfos.emplace_back(
                                frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
                    }

                    this->attachmentInfos[subRendererAttachmentDesc.subpassIndex].emplace_back(imageInfos);
                } else if (subRendererAttachmentDesc.attachmentType == AttachmentType::OUTPUT_SHADER) {
                    if (this->attachmentInfos.size() < subRendererAttachmentDesc.subpassIndex + 1) {
                        this->attachmentInfos.resize(subRendererAttachmentDesc.subpassIndex + 1);
                    }

                    std::vector<VkDescriptorImageInfo> imageInfos{};
                    imageInfos.reserve(frameImages.size());

                    for (auto &&frameImage: frameImages) {
                        imageInfos.emplace_back(frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_GENERAL));
                    }

                    this->attachmentInfos[subRendererAttachmentDesc.subpassIndex].emplace_back(imageInfos);
                } else if (subRendererAttachmentDesc.attachmentType == AttachmentType::OUTPUT_TEXTURE) {
                    for (size_t i = 0; i < this->attachmentSamplers[samplerIndex].size(); i++) {
                        this->attachmentSamplers[samplerIndex][i]->setImage(frameImages[i]);
                    }

                    if (this->attachmentInfos.size() < subRendererAttachmentDesc.subpassIndex + 1) {
                        this->attachmentInfos.resize(subRendererAttachmentDesc.subpassIndex + 1);
                    }

                    std::vector<VkDescriptorImageInfo> imageInfos{};
                    for (auto &&sampler: this->attachmentSamplers[samplerIndex]) {
                        imageInfos.emplace_back(sampler->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
                    }

                    this->attachmentInfos[subRendererAttachmentDesc.subpassIndex].emplace_back(imageInfos);
                    samplerIndex++;
                }
            }
        }

        std::vector<std::vector<VkImageView>> subpassViewImage;
        for (size_t i = 0; i < attachments[0].size(); i++) {
            std::vector<VkImageView> imageViews;
            imageViews.reserve(attachments.size());

            for (auto & attachment : attachments) {
                imageViews.emplace_back(attachment[i]->getImageView());
            }

            subpassViewImage.emplace_back(imageViews);
        }

        this->renderPass->recreateFrameBuffer(subpassViewImage, this->width, this->height, this->layerNum);
    }
} // namespace NugieApp
