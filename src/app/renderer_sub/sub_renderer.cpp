#include "sub_renderer.hpp"

#include <assert.h>
#include <array>

namespace NugieApp {
  SubRenderer::Builder::Builder(NugieVulkan::Device* device, uint32_t width, uint32_t height, uint32_t imageCount, uint32_t layerNum) 
    : device{device}, width{width}, height{height}, imageCount{imageCount}, layerNum{layerNum}
  {

  }

  SubRenderer::Builder& SubRenderer::Builder::addAttachment(uint32_t subpassIndex, AttachmentType attachmentType, 
    VkFormat format, VkImageLayout layout, VkSampleCountFlagBits sample) 
  {
    VkImageUsageFlags imageUsage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSIENT_ATTACHMENT_BIT;
    if (attachmentType == AttachmentType::INPUT_OUTPUT) {
      imageUsage |= VK_IMAGE_USAGE_INPUT_ATTACHMENT_BIT;
    }

    std::vector<NugieVulkan::Image*> frameImages{};
    for (size_t i = 0; i < this->imageCount; i++) {
      frameImages.emplace_back(new NugieVulkan::Image(this->device, this->width, this->height, 1, sample, format,
        VK_IMAGE_TILING_OPTIMAL, imageUsage, VMA_MEMORY_USAGE_AUTO, VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT, 
        VK_IMAGE_ASPECT_COLOR_BIT));
    }

    this->attachments.emplace_back(frameImages);
    this->createdAttachments.emplace_back(frameImages);

    VkAttachmentStoreOp storeOp = attachmentType == AttachmentType::OUTPUT_IMAGE || attachmentType == AttachmentType::OUTPUT_TEXTURE 
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

    if (this->outputAttachmentRefs.size() < subpassIndex + 1) {
      this->outputAttachmentRefs.resize(subpassIndex + 1);
    }

    VkAttachmentReference attachmentRef{};
    attachmentRef.attachment = static_cast<uint32_t>(this->attachments.size() - 1);
    attachmentRef.layout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;

    this->outputAttachmentRefs[subpassIndex].emplace_back(attachmentRef);

    if (attachmentType == AttachmentType::INPUT_OUTPUT) {
      if (this->inputAttachmentRefs.size() < subpassIndex + 1) {
        this->inputAttachmentRefs.resize(subpassIndex + 1);
      }

      VkAttachmentReference attachmentRef{};
      attachmentRef.attachment = static_cast<uint32_t>(this->attachments.size() - 1);
      attachmentRef.layout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

      this->inputAttachmentRefs[subpassIndex].emplace_back(attachmentRef);

      if (this->attachmentInfos.size() < subpassIndex + 1) {
        this->attachmentInfos.resize(subpassIndex + 1);
      }

      std::vector<VkDescriptorImageInfo> imageInfos{};
      for (auto &&frameImage : frameImages) {
        imageInfos.emplace_back(frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
      }

      this->attachmentInfos[subpassIndex].emplace_back(imageInfos);
    }

    else if (attachmentType == AttachmentType::OUTPUT_IMAGE) {
      if (this->attachmentInfos.size() < subpassIndex + 1) {
        this->attachmentInfos.resize(subpassIndex + 1);
      }

      std::vector<VkDescriptorImageInfo> imageInfos{};
      for (auto &&frameImage : frameImages) {
        imageInfos.emplace_back(frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
      }

      this->attachmentInfos[subpassIndex].emplace_back(imageInfos);
    }

    else if (attachmentType == AttachmentType::OUTPUT_TEXTURE) {
      if (this->attachmentInfos.size() < subpassIndex + 1) {
        this->attachmentInfos.resize(subpassIndex + 1);
      }

      std::vector<NugieVulkan::Sampler*> samplers{};
      for (auto &&frameImage : frameImages) {
        samplers.emplace_back(new NugieVulkan::Sampler(this->device, frameImage, VK_FILTER_NEAREST, 
          VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_BORDER, VK_FALSE, VK_BORDER_COLOR_FLOAT_OPAQUE_BLACK, VK_COMPARE_OP_NEVER, 
          VK_SAMPLER_MIPMAP_MODE_NEAREST));
      }

      this->attachmentSamplers.emplace_back(samplers);

      std::vector<VkDescriptorImageInfo> imageInfos{};
      for (auto &&sampler : samplers) {
        imageInfos.emplace_back(sampler->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
      }

      this->attachmentInfos[subpassIndex].emplace_back(imageInfos);
    }

    return *this;
  }

  SubRenderer::Builder& SubRenderer::Builder::addAttachment(const std::vector<NugieVulkan::Image*> &frameImages, 
    uint32_t subpassIndex, AttachmentType attachmentType, VkFormat format, VkImageLayout layout, 
    VkSampleCountFlagBits sample) 
  {
    this->attachments.emplace_back(frameImages);

    VkAttachmentStoreOp storeOp = attachmentType == AttachmentType::OUTPUT_IMAGE || attachmentType == AttachmentType::OUTPUT_TEXTURE 
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

    if (this->outputAttachmentRefs.size() < subpassIndex + 1) {
      this->outputAttachmentRefs.resize(subpassIndex + 1);
    }

    if (this->inputAttachmentRefs.size() < subpassIndex + 1) {
      this->inputAttachmentRefs.resize(subpassIndex + 1);
    }

    VkAttachmentReference attachmentRef{};
    attachmentRef.attachment = static_cast<uint32_t>(this->attachments.size() - 1);
    attachmentRef.layout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;

    this->outputAttachmentRefs[subpassIndex].emplace_back(attachmentRef);

    if (attachmentType == AttachmentType::INPUT_OUTPUT) {
      VkAttachmentReference attachmentRef{};
      attachmentRef.attachment = static_cast<uint32_t>(this->attachments.size() - 1);
      attachmentRef.layout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

      this->inputAttachmentRefs[subpassIndex].emplace_back(attachmentRef);

      if (this->attachmentInfos.size() < subpassIndex + 1) {
        this->attachmentInfos.resize(subpassIndex + 1);
      }

      std::vector<VkDescriptorImageInfo> imageInfos{};
      for (auto &&frameImage : frameImages) {
        imageInfos.emplace_back(frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
      }

      this->attachmentInfos[subpassIndex].emplace_back(imageInfos);
    }

    else if (attachmentType == AttachmentType::OUTPUT_IMAGE) {
      if (this->attachmentInfos.size() < subpassIndex + 1) {
        this->attachmentInfos.resize(subpassIndex + 1);
      }

      std::vector<VkDescriptorImageInfo> imageInfos{};
      for (auto &&frameImage : frameImages) {
        imageInfos.emplace_back(frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
      }

      this->attachmentInfos[subpassIndex].emplace_back(imageInfos);
    }

    else if (attachmentType == AttachmentType::OUTPUT_TEXTURE) {
      if (this->attachmentInfos.size() < subpassIndex + 1) {
        this->attachmentInfos.resize(subpassIndex + 1);
      }

      std::vector<NugieVulkan::Sampler*> samplers{};
      for (auto &&frameImage : frameImages) {
        samplers.emplace_back(new NugieVulkan::Sampler(this->device, frameImage, VK_FILTER_NEAREST, 
          VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_BORDER, VK_FALSE, VK_BORDER_COLOR_FLOAT_OPAQUE_BLACK, VK_COMPARE_OP_NEVER, 
          VK_SAMPLER_MIPMAP_MODE_NEAREST));
      }

      this->attachmentSamplers.emplace_back(samplers);

      std::vector<VkDescriptorImageInfo> imageInfos{};
      for (auto &&sampler : samplers) {
        imageInfos.emplace_back(sampler->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
      }

      this->attachmentInfos[subpassIndex].emplace_back(imageInfos);
    }

    return *this;
  }

  SubRenderer::Builder& SubRenderer::Builder::setDepthAttachment(uint32_t subpassIndex, AttachmentType attachmentType, 
    VkFormat format, VkImageLayout layout, VkSampleCountFlagBits sample) 
  {
    std::vector<NugieVulkan::Image*> frameImages{};
    for (size_t i = 0; i < this->imageCount; i++) {
      frameImages.emplace_back(new NugieVulkan::Image(this->device, this->width, this->height, 1, sample, format,
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSIENT_ATTACHMENT_BIT, 
        VMA_MEMORY_USAGE_AUTO, VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT, VK_IMAGE_ASPECT_DEPTH_BIT));
    }

    this->attachments.emplace_back(frameImages);
    this->createdAttachments.emplace_back(frameImages);

    VkAttachmentStoreOp storeOp = attachmentType == AttachmentType::OUTPUT_IMAGE || attachmentType == AttachmentType::OUTPUT_TEXTURE 
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

    if (this->depthAttachmentRefs.size() < subpassIndex + 1) {
      this->depthAttachmentRefs.resize(subpassIndex + 1);
    }

    VkAttachmentReference attachmentRef{};
    attachmentRef.attachment = static_cast<uint32_t>(this->attachments.size() - 1);
    attachmentRef.layout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;

    this->depthAttachmentRefs[subpassIndex] = attachmentRef;

    if (attachmentType == AttachmentType::INPUT_OUTPUT) {
      VkAttachmentReference attachmentRef{};
      attachmentRef.attachment = static_cast<uint32_t>(this->attachments.size() - 1);
      attachmentRef.layout = VK_IMAGE_LAYOUT_DEPTH_READ_ONLY_OPTIMAL;

      this->inputAttachmentRefs[subpassIndex].emplace_back(attachmentRef);

      if (this->attachmentInfos.size() < subpassIndex + 1) {
        this->attachmentInfos.resize(subpassIndex + 1);
      }

      std::vector<VkDescriptorImageInfo> imageInfos{};
      for (auto &&frameImage : frameImages) {
        imageInfos.emplace_back(frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_DEPTH_READ_ONLY_OPTIMAL));
      }

      this->attachmentInfos[subpassIndex].emplace_back(imageInfos);
    }

    else if (attachmentType == AttachmentType::OUTPUT_IMAGE) {
      if (this->attachmentInfos.size() < subpassIndex + 1) {
        this->attachmentInfos.resize(subpassIndex + 1);
      }

      std::vector<VkDescriptorImageInfo> imageInfos{};
      for (auto &&frameImage : frameImages) {
        imageInfos.emplace_back(frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_DEPTH_READ_ONLY_OPTIMAL));
      }

      this->attachmentInfos[subpassIndex].emplace_back(imageInfos);
    }

    else if (attachmentType == AttachmentType::OUTPUT_TEXTURE) {
      if (this->attachmentInfos.size() < subpassIndex + 1) {
        this->attachmentInfos.resize(subpassIndex + 1);
      }

      std::vector<NugieVulkan::Sampler*> samplers{};
      for (auto &&frameImage : frameImages) {
        samplers.emplace_back(new NugieVulkan::Sampler(this->device, frameImage, VK_FILTER_NEAREST, 
          VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE, VK_FALSE, VK_BORDER_COLOR_FLOAT_OPAQUE_WHITE, VK_COMPARE_OP_NEVER, 
          VK_SAMPLER_MIPMAP_MODE_NEAREST));
      }

      this->attachmentSamplers.emplace_back(samplers);

      std::vector<VkDescriptorImageInfo> imageInfos{};
      for (auto &&sampler : samplers) {
        imageInfos.emplace_back(sampler->getDescriptorInfo(VK_IMAGE_LAYOUT_DEPTH_READ_ONLY_OPTIMAL));
      }

      this->attachmentInfos[subpassIndex].emplace_back(imageInfos);
    }

    return *this;
  }

  SubRenderer::Builder& SubRenderer::Builder::setResolvedAttachment(const std::vector<NugieVulkan::Image*> &resolvedImages, 
    VkFormat format, VkImageLayout layout) 
  {
    this->attachments.emplace_back(resolvedImages);

    VkAttachmentDescription attachmentDesc{};
    attachmentDesc.format = format;
    attachmentDesc.samples = VK_SAMPLE_COUNT_1_BIT;
    attachmentDesc.loadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    attachmentDesc.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
    attachmentDesc.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    attachmentDesc.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    attachmentDesc.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    attachmentDesc.finalLayout = layout;

    this->attachmentDescs.emplace_back(attachmentDesc);

    VkAttachmentReference* attachmentRef = new VkAttachmentReference();
    attachmentRef->attachment = static_cast<uint32_t>(this->attachments.size() - 1);
    attachmentRef->layout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;

    this->resolveAttachmentRef = attachmentRef;

    return *this;
  }

  SubRenderer* SubRenderer::Builder::build() {
    std::vector<std::vector<NugieVulkan::Image*>> attachments = this->attachments;
    

    return new SubRenderer(this->device, this->width, this->height, this->layerNum, this->attachments, this->createdAttachments, 
      this->attachmentDescs, this->outputAttachmentRefs, this->depthAttachmentRefs, this->inputAttachmentRefs, 
      this->resolveAttachmentRef, this->attachmentSamplers, this->attachmentInfos);
  }

  SubRenderer::Overwriter::Overwriter(NugieVulkan::Device* device, uint32_t width, uint32_t height, uint32_t imageCount, uint32_t layerNum) 
    : device{device}, width{width}, height{height}, imageCount{imageCount}, layerNum{layerNum}
  {

  }

  SubRenderer::Overwriter& SubRenderer::Overwriter::addAttachment(uint32_t subpassIndex, AttachmentType attachmentType, VkFormat format, 
    VkSampleCountFlagBits sample) 
  {
    VkImageUsageFlags imageUsage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSIENT_ATTACHMENT_BIT;
    if (attachmentType == AttachmentType::INPUT_OUTPUT) {
      imageUsage |= VK_IMAGE_USAGE_INPUT_ATTACHMENT_BIT;
    }

    std::vector<NugieVulkan::Image*> frameImages{};
    for (size_t i = 0; i < this->imageCount; i++) {
      frameImages.emplace_back(new NugieVulkan::Image(this->device, this->width, this->height, 1, sample, format,
        VK_IMAGE_TILING_OPTIMAL, imageUsage, VMA_MEMORY_USAGE_AUTO, VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT,
        VK_IMAGE_ASPECT_COLOR_BIT));
    }

    this->attachments.emplace_back(frameImages);
    this->createdAttachments.emplace_back(frameImages);

    if (attachmentType == AttachmentType::INPUT_OUTPUT) {
      if (this->attachmentInfos.size() < subpassIndex + 1) {
        this->attachmentInfos.resize(subpassIndex + 1);
      }

      std::vector<VkDescriptorImageInfo> imageInfos{};
      for (auto &&frameImage : frameImages) {
        imageInfos.emplace_back(frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
      }

      this->attachmentInfos[subpassIndex].emplace_back(imageInfos);
    }

    else if (attachmentType == AttachmentType::OUTPUT_IMAGE) {
      if (this->attachmentInfos.size() < subpassIndex + 1) {
        this->attachmentInfos.resize(subpassIndex + 1);
      }

      std::vector<VkDescriptorImageInfo> imageInfos{};
      for (auto &&frameImage : frameImages) {
        imageInfos.emplace_back(frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
      }

      this->attachmentInfos[subpassIndex].emplace_back(imageInfos);
    }

    else if (attachmentType == AttachmentType::OUTPUT_TEXTURE) {
      if (this->attachmentInfos.size() < subpassIndex + 1) {
        this->attachmentInfos.resize(subpassIndex + 1);
      }

      std::vector<NugieVulkan::Sampler*> samplers{};
      for (auto &&frameImage : frameImages) {
        samplers.emplace_back(new NugieVulkan::Sampler(this->device, frameImage, VK_FILTER_NEAREST, 
          VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_BORDER, VK_FALSE, VK_BORDER_COLOR_FLOAT_OPAQUE_BLACK, VK_COMPARE_OP_NEVER, 
          VK_SAMPLER_MIPMAP_MODE_NEAREST));
      }

      this->attachmentSamplers.emplace_back(samplers);

      std::vector<VkDescriptorImageInfo> imageInfos{};
      for (auto &&sampler : samplers) {
        imageInfos.emplace_back(sampler->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
      }

      this->attachmentInfos[subpassIndex].emplace_back(imageInfos);
    }

    return *this;
  }

  SubRenderer::Overwriter& SubRenderer::Overwriter::addAttachment(const std::vector<NugieVulkan::Image*> &frameImages, uint32_t subpassIndex, AttachmentType attachmentType) 
  {
    this->attachments.emplace_back(frameImages);

    if (attachmentType == AttachmentType::INPUT_OUTPUT) {
      if (this->attachmentInfos.size() < subpassIndex + 1) {
        this->attachmentInfos.resize(subpassIndex + 1);
      }

      std::vector<VkDescriptorImageInfo> imageInfos{};
      for (auto &&frameImage : frameImages) {
        imageInfos.emplace_back(frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
      }

      this->attachmentInfos[subpassIndex].emplace_back(imageInfos);
    }

    else if (attachmentType == AttachmentType::OUTPUT_IMAGE) {
      if (this->attachmentInfos.size() < subpassIndex + 1) {
        this->attachmentInfos.resize(subpassIndex + 1);
      }

      std::vector<VkDescriptorImageInfo> imageInfos{};
      for (auto &&frameImage : frameImages) {
        imageInfos.emplace_back(frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
      }

      this->attachmentInfos[subpassIndex].emplace_back(imageInfos);
    }

    else if (attachmentType == AttachmentType::OUTPUT_TEXTURE) {
      if (this->attachmentInfos.size() < subpassIndex + 1) {
        this->attachmentInfos.resize(subpassIndex + 1);
      }

      std::vector<NugieVulkan::Sampler*> samplers{};
      for (auto &&frameImage : frameImages) {
        samplers.emplace_back(new NugieVulkan::Sampler(this->device, frameImage, VK_FILTER_NEAREST, 
          VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_BORDER, VK_FALSE, VK_BORDER_COLOR_FLOAT_OPAQUE_BLACK, VK_COMPARE_OP_NEVER, 
          VK_SAMPLER_MIPMAP_MODE_NEAREST));
      }

      this->attachmentSamplers.emplace_back(samplers);

      std::vector<VkDescriptorImageInfo> imageInfos{};
      for (auto &&sampler : samplers) {
        imageInfos.emplace_back(sampler->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
      }

      this->attachmentInfos[subpassIndex].emplace_back(imageInfos);
    }

    return *this;
  }

  SubRenderer::Overwriter& SubRenderer::Overwriter::setDepthAttachment(uint32_t subpassIndex, AttachmentType attachmentType, VkFormat format, VkSampleCountFlagBits sample) 
  {
    std::vector<NugieVulkan::Image*> frameImages{};
    for (size_t i = 0; i < this->imageCount; i++) {
      frameImages.emplace_back(new NugieVulkan::Image(this->device, this->width, this->height, 1, sample, format,
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSIENT_ATTACHMENT_BIT, 
        VMA_MEMORY_USAGE_AUTO, VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT, VK_IMAGE_ASPECT_DEPTH_BIT));
    }

    this->attachments.emplace_back(frameImages);
    this->createdAttachments.emplace_back(frameImages);

    if (attachmentType == AttachmentType::INPUT_OUTPUT) {
      if (this->attachmentInfos.size() < subpassIndex + 1) {
        this->attachmentInfos.resize(subpassIndex + 1);
      }

      std::vector<VkDescriptorImageInfo> imageInfos{};
      for (auto &&frameImage : frameImages) {
        imageInfos.emplace_back(frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_DEPTH_READ_ONLY_OPTIMAL));
      }

      this->attachmentInfos[subpassIndex].emplace_back(imageInfos);
    }

    else if (attachmentType == AttachmentType::OUTPUT_IMAGE) {
      if (this->attachmentInfos.size() < subpassIndex + 1) {
        this->attachmentInfos.resize(subpassIndex + 1);
      }

      std::vector<VkDescriptorImageInfo> imageInfos{};
      for (auto &&frameImage : frameImages) {
        imageInfos.emplace_back(frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_DEPTH_READ_ONLY_OPTIMAL));
      }

      this->attachmentInfos[subpassIndex].emplace_back(imageInfos);
    }

    else if (attachmentType == AttachmentType::OUTPUT_TEXTURE) {
      if (this->attachmentInfos.size() < subpassIndex + 1) {
        this->attachmentInfos.resize(subpassIndex + 1);
      }

      std::vector<NugieVulkan::Sampler*> samplers{};
      for (auto &&frameImage : frameImages) {
        samplers.emplace_back(new NugieVulkan::Sampler(this->device, frameImage, VK_FILTER_NEAREST, 
          VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE, VK_FALSE, VK_BORDER_COLOR_FLOAT_OPAQUE_WHITE, VK_COMPARE_OP_NEVER, 
          VK_SAMPLER_MIPMAP_MODE_NEAREST));
      }

      this->attachmentSamplers.emplace_back(samplers);

      std::vector<VkDescriptorImageInfo> imageInfos{};
      for (auto &&sampler : samplers) {
        imageInfos.emplace_back(sampler->getDescriptorInfo(VK_IMAGE_LAYOUT_DEPTH_READ_ONLY_OPTIMAL));
      }

      this->attachmentInfos[subpassIndex].emplace_back(imageInfos);
    }

    return *this;
  }

  SubRenderer::Overwriter& SubRenderer::Overwriter::setResolvedAttachment(const std::vector<NugieVulkan::Image*> &resolvedImages) 
  {
    this->attachments.emplace_back(resolvedImages);
    return *this;
  }

  void SubRenderer::Overwriter::overwrite(SubRenderer* subRenderer) {
    subRenderer->recreateResources(this->width, this->height, this->attachments, this->createdAttachments, 
      this->attachmentSamplers, this->attachmentInfos);
  }

  SubRenderer::SubRenderer(NugieVulkan::Device* device, uint32_t width, uint32_t height, uint32_t layerNum, const std::vector<std::vector<NugieVulkan::Image*>> &attachments, 
    const std::vector<std::vector<NugieVulkan::Image*>> &createdAttachments, const std::vector<VkAttachmentDescription> &attachmentDescs, 
    const std::vector<std::vector<VkAttachmentReference>> &outputAttachmentRefs, const std::vector<VkAttachmentReference> &depthAttachmentRefs, 
    const std::vector<std::vector<VkAttachmentReference>> &inputAttachmentRefs, VkAttachmentReference* resolveAttachmentRef, 
    const std::vector<std::vector<NugieVulkan::Sampler*>> &attachmentSamplers,
    const std::vector<std::vector<std::vector<VkDescriptorImageInfo>>> &attachmentInfos)
    : device{device}, width{width}, height{height}, layerNum{layerNum}, createdAttachments{createdAttachments}, 
      attachmentSamplers{attachmentSamplers}, attachmentInfos{attachmentInfos}
  { 
    this->createRenderPass(attachments, attachmentDescs, outputAttachmentRefs, depthAttachmentRefs, inputAttachmentRefs, resolveAttachmentRef);
  }

  SubRenderer::~SubRenderer() {
    if (this->renderPass != nullptr) delete this->renderPass;

    for (auto &&attachmentSampler : attachmentSamplers) {
      for (auto &&sampler : attachmentSampler) {
        if (sampler != nullptr) delete sampler;
      }
    }

    for (auto &&createdAttachment : this->createdAttachments) {
      for (auto &&attachment : createdAttachment) {
        if (attachment != nullptr) delete attachment;
      }
    }
  }

  void SubRenderer::createRenderPass(const std::vector<std::vector<NugieVulkan::Image*>> &attachments, const std::vector<VkAttachmentDescription> &attachmentDescs, 
    const std::vector<std::vector<VkAttachmentReference>> &outputAttachmentRefs, const std::vector<VkAttachmentReference> &depthAttachmentRefs, 
    const std::vector<std::vector<VkAttachmentReference>> &inputAttachmentRefs, VkAttachmentReference* resolveAttachmentRef)
  {
    std::vector<VkSubpassDescription> subpasses;
    std::vector<VkSubpassDependency> subpassDependencies;

    this->clearValues.clear();
    for (size_t i = 0; i < depthAttachmentRefs.size(); i++) {
      VkSubpassDescription subpass{};

      subpass.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
      
      subpass.colorAttachmentCount = static_cast<uint32_t>(outputAttachmentRefs[i].size());
      subpass.pColorAttachments = outputAttachmentRefs[i].size() > 0 ? outputAttachmentRefs[i].data() : nullptr;
      subpass.pDepthStencilAttachment = &depthAttachmentRefs[i];

      if (i > 0) {
        subpass.inputAttachmentCount = static_cast<uint32_t>(inputAttachmentRefs[i - 1].size());
        subpass.pInputAttachments = inputAttachmentRefs[i - 1].size() > 0 ? inputAttachmentRefs[i - 1].data() : nullptr;
      }

      subpasses.emplace_back(subpass);

      for (auto &&outputAttachmentRef : outputAttachmentRefs[i]) {
        VkClearValue clearValue;
        clearValue.color = {0.0f, 0.0f, 0.0f, 1.0f};

        this->clearValues.emplace_back(clearValue);
      }
      
      VkClearValue clearValue;
      clearValue.depthStencil = {1.0f, 0};

      this->clearValues.emplace_back(clearValue);
    }

    if (resolveAttachmentRef != nullptr) {
      subpasses[subpasses.size() - 1].pResolveAttachments = resolveAttachmentRef;
    }

    auto renderPassBuilder = NugieVulkan::RenderPass::Builder(this->device, this->width, this->height, this->layerNum);
    for (size_t i = 0; i < subpasses.size(); i++) {
      renderPassBuilder.addSubpass(subpasses[i]);
    }

    for (size_t i = 0; i < attachmentDescs.size(); i++) {
      renderPassBuilder.addAttachment(attachmentDescs[i]);
    }

    for (size_t i = 0; i < attachments[0].size(); i++) {
      std::vector<VkImageView> imageViews;
      for (size_t j = 0; j < attachments.size(); j++) {
        imageViews.emplace_back(attachments[j][i]->getImageView());
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

    if (outputAttachmentRefs.size() > 0 && resolveAttachmentRef != nullptr) {
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
    
    else if (depthAttachmentRefs.size() > 0) {
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

  void SubRenderer::beginRenderPass(NugieVulkan::CommandBuffer* commandBuffer, uint32_t imageIndex) {
		VkRenderPassBeginInfo renderBeginInfo{};
		renderBeginInfo.sType = VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO;
		renderBeginInfo.renderPass = this->getRenderPass()->getRenderPass();
		renderBeginInfo.framebuffer = this->getRenderPass()->getFramebuffers(imageIndex);

		renderBeginInfo.renderArea.offset = { 0, 0 };
		renderBeginInfo.renderArea.extent = { static_cast<uint32_t>(this->width), static_cast<uint32_t>(this->height) };
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

		VkRect2D scissor{ {0, 0}, { static_cast<uint32_t>(this->width), static_cast<uint32_t>(this->height) }};
    
		vkCmdSetViewport(commandBuffer->getCommandBuffer(), 0, 1, &viewport);
		vkCmdSetScissor(commandBuffer->getCommandBuffer(), 0, 1, &scissor);
	}

  void SubRenderer::nextSubpass(NugieVulkan::CommandBuffer* commandBuffer, VkSubpassContents subPassContent) {
    vkCmdNextSubpass(commandBuffer->getCommandBuffer(), subPassContent);
  }

	void SubRenderer::endRenderPass(NugieVulkan::CommandBuffer* commandBuffer) {
		vkCmdEndRenderPass(commandBuffer->getCommandBuffer());
	}

  void SubRenderer::deleteCreatedAttachments() {
    for (auto &&attachmentSampler : this->attachmentSamplers) {
      for (auto &&sampler : attachmentSampler) {
        if (sampler != nullptr) delete sampler;
      }
    }

    for (auto &&createdAttachment : this->createdAttachments) {
      for (auto &&attachment : createdAttachment) {
        if (attachment != nullptr) delete attachment;
      }
    }
  }

  void SubRenderer::recreateResources(uint32_t width, uint32_t height, const std::vector<std::vector<NugieVulkan::Image*>> &attachments, 
    const std::vector<std::vector<NugieVulkan::Image*>> &createdAttachments, 
    const std::vector<std::vector<NugieVulkan::Sampler*>> &attachmentSamplers,
    const std::vector<std::vector<std::vector<VkDescriptorImageInfo>>> &attachmentInfos) 
  {
    this->width = width;
    this->height = height;

    this->createdAttachments = createdAttachments;
    this->attachmentSamplers = attachmentSamplers;
    this->attachmentInfos = attachmentInfos;

    std::vector<std::vector<VkImageView>> subpassViewImage;
    for (size_t i = 0; i < attachments[0].size(); i++) {
      std::vector<VkImageView> imageViews;
      for (size_t j = 0; j < attachments.size(); j++) {
        imageViews.emplace_back(attachments[j][i]->getImageView());
      }

      subpassViewImage.emplace_back(imageViews);
    }

    this->renderPass->recreateFrameBuffer(subpassViewImage, this->width, this->height, this->layerNum);
  }
  
} // namespace NugieApp
