#include "attachment_deferred_desc_set.hpp"
#include "../../../vulkan/descriptor/descriptor_writer.hpp"

namespace NugieApp {
  AttachmentDeferredDescSet::AttachmentDeferredDescSet(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool,
		std::vector<VkDescriptorImageInfo> attachmentsInfo[5], uint32_t imageCount) 
		: device{device}, descriptorPool{descriptorPool}, imageCount{imageCount} 
	{
		this->createDescriptorLayout();
		this->createDescriptorSet(attachmentsInfo);
  }

	AttachmentDeferredDescSet::~AttachmentDeferredDescSet() {
		if (this->descSetLayout != nullptr) delete this->descSetLayout;
	}

	void AttachmentDeferredDescSet::createDescriptorLayout() {
		this->descSetLayout = 
			NugieVulkan::DescriptorSetLayout::Builder(this->device)
				.addBinding(0, VK_DESCRIPTOR_TYPE_INPUT_ATTACHMENT, VK_SHADER_STAGE_FRAGMENT_BIT)
				.addBinding(1, VK_DESCRIPTOR_TYPE_INPUT_ATTACHMENT, VK_SHADER_STAGE_FRAGMENT_BIT)
				.addBinding(2, VK_DESCRIPTOR_TYPE_INPUT_ATTACHMENT, VK_SHADER_STAGE_FRAGMENT_BIT)
				.addBinding(3, VK_DESCRIPTOR_TYPE_INPUT_ATTACHMENT, VK_SHADER_STAGE_FRAGMENT_BIT)
				.build();
	}

  void AttachmentDeferredDescSet::createDescriptorSet(std::vector<VkDescriptorImageInfo> attachmentsInfo[5]) 
	{	
		this->descriptorSets.clear();
		for (int i = 0; i < this->imageCount; i++) {
			VkDescriptorSet descSet;

			NugieVulkan::DescriptorWriter(this->device, this->descSetLayout, this->descriptorPool)
				.writeImage(0, attachmentsInfo[0][i])
				.writeImage(1, attachmentsInfo[1][i])
				.writeImage(2, attachmentsInfo[2][i])
				.writeImage(3, attachmentsInfo[3][i])
				.build(&descSet);

			this->descriptorSets.emplace_back(descSet);
		}
  }

	void AttachmentDeferredDescSet::recreateDescriptorSet(std::vector<VkDescriptorImageInfo> attachmentsInfo[5]) 
	{
		this->descriptorPool->free(this->descriptorSets);
		this->createDescriptorSet(attachmentsInfo);
	}
}