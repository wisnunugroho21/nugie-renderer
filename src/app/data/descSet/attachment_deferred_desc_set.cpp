#include "attachment_deferred_desc_set.hpp"
#include "../../../vulkan/descriptor/descriptor_writer.hpp"

namespace NugieApp {
  AttachmentDeferredDescSet::AttachmentDeferredDescSet(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool,
		std::vector<VkDescriptorImageInfo> attachmentsInfo[5], uint32_t imageCount) 
	{
		this->createDescriptor(device, descriptorPool, attachmentsInfo, imageCount);
  }

	AttachmentDeferredDescSet::~AttachmentDeferredDescSet() {
		if (this->descSetLayout != nullptr) delete this->descSetLayout;
	}

  void AttachmentDeferredDescSet::createDescriptor(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool,
		std::vector<VkDescriptorImageInfo> attachmentsInfo[5], uint32_t imageCount) 
	{
    this->descSetLayout = 
			NugieVulkan::DescriptorSetLayout::Builder(device)
				.addBinding(0, VK_DESCRIPTOR_TYPE_INPUT_ATTACHMENT, VK_SHADER_STAGE_FRAGMENT_BIT)
				.addBinding(1, VK_DESCRIPTOR_TYPE_INPUT_ATTACHMENT, VK_SHADER_STAGE_FRAGMENT_BIT)
				.addBinding(2, VK_DESCRIPTOR_TYPE_INPUT_ATTACHMENT, VK_SHADER_STAGE_FRAGMENT_BIT)
				.addBinding(3, VK_DESCRIPTOR_TYPE_INPUT_ATTACHMENT, VK_SHADER_STAGE_FRAGMENT_BIT)
				.build();
		
		this->descriptorSets.clear();
		for (int i = 0; i < imageCount; i++) {
			VkDescriptorSet descSet;

			NugieVulkan::DescriptorWriter(device, this->descSetLayout, descriptorPool)
				.writeImage(0, attachmentsInfo[0][i])
				.writeImage(1, attachmentsInfo[1][i])
				.writeImage(2, attachmentsInfo[2][i])
				.writeImage(3, attachmentsInfo[3][i])
				.build(&descSet);

			this->descriptorSets.emplace_back(descSet);
		}
  }
}