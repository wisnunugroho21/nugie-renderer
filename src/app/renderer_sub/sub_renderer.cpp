#include "sub_renderer.hpp"

#include <assert.h>
#include <array>

namespace NugieApp {
  SubRenderer::Builder::Builder(NugieVulkan::Device* device, uint32_t width, uint32_t height, uint32_t imageCount, uint32_t layerNum) 
    : device{device}, width{width}, height{height}, imageCount{imageCount}, layerNum{layerNum}
  {

  }

  SubRenderer::Builder& SubRenderer::Builder::addAttachment(uint32_t subpassIndex, AttachmentType attachmentType, VkFormat format, VkImageLayout layout, 
    VkSampleCountFlagBits sample, VkAttachmentLoadOp loadOp, VkAttachmentStoreOp storeOp) 
  {
    VkImageUsageFlags imageUsage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSIENT_ATTACHMENT_BIT;
    if (attachmentType == AttachmentType::INPUT_OUTPUT) {
      imageUsage |= VK_IMAGE_USAGE_INPUT_ATTACHMENT_BIT;
    }

    std::vector<NugieVulkan::Image*> frameImages{};
    for (size_t i = 0; i < this->imageCount; i++) {
      frameImages.emplace_back(new NugieVulkan::Image(this->device, this->width, this->height, 1, sample, format,
        VK_IMAGE_TILING_OPTIMAL, imageUsage, { VK_MEMORY_PROPERTY_LAZILY_ALLOCATED_BIT, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT }, 
        VK_IMAGE_ASPECT_COLOR_BIT));
    }

    this->attachments.emplace_back(frameImages);
    this->createdAttachments.emplace_back(frameImages);

    VkAttachmentDescription attachmentDesc{};
    attachmentDesc.format = format;
    attachmentDesc.samples = sample;
    attachmentDesc.loadOp = loadOp;
    attachmentDesc.storeOp = storeOp;
    attachmentDesc.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    attachmentDesc.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    attachmentDesc.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    attachmentDesc.finalLayout = layout;

    this->attachmentDescs.emplace_back(attachmentDesc);

    if (this->outputAttachmentRefs.size() < subpassIndex + 1) {
      this->outputAttachmentRefs.resize(subpassIndex + 1);
    }

    if (this->inputAttachmentRefs.size() < subpassIndex + 2) {
      this->inputAttachmentRefs.resize(subpassIndex + 2);
    }

    VkAttachmentReference attachmentRef{};
    attachmentRef.attachment = static_cast<uint32_t>(this->attachments.size() - 1);
    attachmentRef.layout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;

    this->outputAttachmentRefs[subpassIndex].emplace_back(attachmentRef);

    if (attachmentType == AttachmentType::INPUT_OUTPUT) {
      VkAttachmentReference attachmentRef{};
      attachmentRef.attachment = static_cast<uint32_t>(this->attachments.size() - 1);
      attachmentRef.layout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

      this->inputAttachmentRefs[subpassIndex + 1].emplace_back(attachmentRef);

      if (this->attachmentInfos.size() < subpassIndex + 1) {
        this->attachmentInfos.resize(subpassIndex + 1);
      }

      std::vector<VkDescriptorImageInfo> imageInfos{};
      for (auto &&frameImage : frameImages) {
        imageInfos.emplace_back(frameImage->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
      }

      this->attachmentInfos[subpassIndex].emplace_back(imageInfos);
    }

    return *this;
  }

  SubRenderer::Builder& SubRenderer::Builder::setDepthAttachment(uint32_t subpassIndex, VkFormat format, VkImageLayout layout, 
    VkSampleCountFlagBits sample, VkAttachmentLoadOp loadOp, VkAttachmentStoreOp storeOp) 
  {
    std::vector<NugieVulkan::Image*> frameImages{};
    for (size_t i = 0; i < this->imageCount; i++) {
      frameImages.emplace_back(new NugieVulkan::Image(this->device, this->width, this->height, 1, sample, format,
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSIENT_ATTACHMENT_BIT, 
        { VK_MEMORY_PROPERTY_LAZILY_ALLOCATED_BIT, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT }, 
        VK_IMAGE_ASPECT_DEPTH_BIT));
    }

    this->attachments.emplace_back(frameImages);
    this->createdAttachments.emplace_back(frameImages);

    VkAttachmentDescription attachmentDesc{};
    attachmentDesc.format = format;
    attachmentDesc.samples = sample;
    attachmentDesc.loadOp = loadOp;
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

    return *this;
  }

  SubRenderer::Builder& SubRenderer::Builder::setResolvedAttachment(std::vector<NugieVulkan::Image*> resolvedImages, VkFormat format, 
    VkImageLayout layout, VkSampleCountFlagBits sample, VkAttachmentLoadOp loadOp, VkAttachmentStoreOp storeOp) 
  {
    this->attachments.emplace_back(resolvedImages);

    VkAttachmentDescription attachmentDesc{};
    attachmentDesc.format = format;
    attachmentDesc.samples = sample;
    attachmentDesc.loadOp = loadOp;
    attachmentDesc.storeOp = storeOp;
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
      this->resolveAttachmentRef, this->attachmentInfos);
  }

  SubRenderer::SubRenderer(NugieVulkan::Device* device, uint32_t width, uint32_t height, uint32_t layerNum, const std::vector<std::vector<NugieVulkan::Image*>> &attachments, 
    const std::vector<std::vector<NugieVulkan::Image*>> &createdAttachments, const std::vector<VkAttachmentDescription> &attachmentDescs, 
    const std::vector<std::vector<VkAttachmentReference>> &outputAttachmentRefs, const std::vector<VkAttachmentReference> &depthAttachmentRefs, 
    const std::vector<std::vector<VkAttachmentReference>> &inputAttachmentRefs, VkAttachmentReference* resolveAttachmentRef, 
    const std::vector<std::vector<std::vector<VkDescriptorImageInfo>>> &attachmentInfos)
    : device{device}, width{width}, height{height}, layerNum{layerNum}, createdAttachments{createdAttachments}, 
      attachmentInfos{attachmentInfos}
  { 
    this->createRenderPass(attachments, attachmentDescs, outputAttachmentRefs, depthAttachmentRefs, inputAttachmentRefs, resolveAttachmentRef);
  }

  SubRenderer::~SubRenderer() {
    if (this->renderPass != nullptr) delete this->renderPass;

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
      subpass.inputAttachmentCount = static_cast<uint32_t>(inputAttachmentRefs[i].size());
      subpass.pInputAttachments = inputAttachmentRefs[i].size() > 0 ? inputAttachmentRefs[i].data() : nullptr;
      subpass.colorAttachmentCount = static_cast<uint32_t>(outputAttachmentRefs[i].size());
      subpass.pColorAttachments = outputAttachmentRefs[i].size() > 0 ? outputAttachmentRefs[i].data() : nullptr;
      subpass.pDepthStencilAttachment = &depthAttachmentRefs[i];

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
      renderPassBuilder = renderPassBuilder
        .addSubpass(subpasses[i]);
    }

    for (size_t i = 0; i < attachmentDescs.size(); i++) {
      renderPassBuilder = renderPassBuilder
        .addAttachment(attachmentDescs[i]);
    }

    for (size_t i = 0; i < attachments[0].size(); i++) {
      std::vector<VkImageView> imageViews;
      for (size_t j = 0; j < attachments.size(); j++) {
        imageViews.emplace_back(attachments[j][i]->getImageView());
      }

      renderPassBuilder = renderPassBuilder.addViewImages(imageViews);
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

      renderPassBuilder = renderPassBuilder.addDependency(dependency);
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

      renderPassBuilder = renderPassBuilder.addDependency(postColorDependency);
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

      renderPassBuilder = renderPassBuilder.addDependency(postDepthDependency);
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

  void SubRenderer::recreateResources(const std::vector<std::vector<VkImageView>> &attachments, uint32_t width, uint32_t height) {
    this->width = width;
    this->height = height;

    this->renderPass->recreateFrameBuffer(attachments, this->width, this->height, this->layerNum);
  }
  
} // namespace NugieApp
